const {
  api,
  createUser,
  login,
  authHeader,
  approvedPatent,
  createAdmin,
  seedOutboxEvent,
} = require('./helpers');
const { fakeStorage, fakeProducer } = require('./fakes');
const storageService = require('../src/services/storageService');
const outboxService = require('../src/services/outboxService');
const { start } = require('../src/workers/outboxRelay');
const { requestContext } = require('../src/middlewares/requestContext');
const { loginRateLimitKey } = require('../src/middlewares/rateLimit');

/**
 * Operational surfaces: the probes an orchestrator acts on, the header used to
 * trace a failure, and the loop's resilience to a failing pass. Getting these
 * wrong does not break a feature — it breaks the ability to run or diagnose the
 * service, which is worse because it shows up during an incident.
 */

describe('GET /health', () => {
  it('is public and answers without touching a dependency', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /ready', () => {
  // The server provisions the bucket at boot; the storage fake resets
  // between tests, so do the equivalent here.
  beforeEach(() => storageService.ensureBucket());

  it('reports every dependency and the outbox backlog', async () => {
    const res = await api().get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.checks.storage).toBe('ok');
    expect(res.body.checks.outbox).toEqual({ pending: 0, retrying: 0, deadLettered: 0 });
  });

  it('counts pending events so a stalled relay is visible', async () => {
    await seedOutboxEvent();
    await seedOutboxEvent();

    const res = await api().get('/ready');

    expect(res.body.checks.outbox.pending).toBe(2);
  });

  it('goes 503 when storage is unreachable', async () => {
    const spy = jest
      .spyOn(storageService, 'checkHealth')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:9000'));

    const res = await api().get('/ready');
    spy.mockRestore();

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.storage).toBe('error');
  });

  /**
   * The probe is unauthenticated, so a driver message — which carries hosts,
   * ports, database and bucket names, sometimes a credential id — must not be
   * echoed to whoever curls it.
   */
  it('never returns the underlying error text', async () => {
    const spy = jest
      .spyOn(storageService, 'checkHealth')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:9000 key=AKIAEXAMPLE'));

    const res = await api().get('/ready');
    spy.mockRestore();

    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|AKIA/);
  });

  /**
   * A Kafka outage must not take the API out of rotation: writes go to the
   * outbox table, which is exactly what decouples the two.
   */
  it('stays ready while events are queued up', async () => {
    await createUser({ email: 'inventor@example.com' });
    await createAdmin();
    const token = (await login('inventor@example.com')).accessToken;
    const adminToken = (await login('admin@example.com')).accessToken;
    await approvedPatent(token, adminToken);

    const res = await api().get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.checks.outbox.pending).toBeGreaterThan(0);
  });

  it('reports a failed backlog query without failing the probe', async () => {
    const spy = jest.spyOn(outboxService, 'stats').mockRejectedValueOnce(new Error('boom'));

    const res = await api().get('/ready');
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.checks.outbox).toBe('error');
  });
});

describe('X-Request-Id', () => {
  it('generates one when the client sends none', async () => {
    const res = await api().get('/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed inbound id so a trace survives the hop', async () => {
    const res = await api().get('/health').set('X-Request-Id', 'trace-abc-123');

    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  const rejected = [
    ['an injected newline', 'abc\ndef'],
    ['a header-splitting attempt', 'abc\r\nSet-Cookie: x=1'],
    ['unexpected punctuation', 'abc;drop'],
    ['a quote', 'abc"def'],
    ['an over-long value', 'a'.repeat(200)],
    ['an empty value', ''],
  ];

  /**
   * An echoed header is attacker-controlled input, so only a safe shape passes
   * through. Driven against the middleware rather than over HTTP because Node
   * refuses to send a header containing a newline at all — a second line of
   * defence, not a reason to leave this unchecked.
   */
  it.each(rejected)('replaces %s with a generated id', (_label, value) => {
    const req = { headers: { 'x-request-id': value } };
    const res = { setHeader: jest.fn() };

    requestContext(req, res, () => {});

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
  });

  it('attaches the id to the request for logging', () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };

    requestContext(req, res, () => {});

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
  });
});

describe('rate limiting', () => {
  /**
   * The limiter is disabled under NODE_ENV=test, because the suite fires many
   * failed logins in a row and a limiter would make assertions depend on
   * execution order. That skip is itself worth pinning: if it ever stops
   * applying, unrelated tests start failing in confusing ways.
   */
  it('is disabled under test so repeated failures do not trip it', async () => {
    await createUser({ email: 'target@example.com' });

    const attempts = await Promise.all(
      Array.from({ length: 15 }, () =>
        api().post('/api/users/login').send({ email: 'target@example.com', password: 'WrongPass1' }),
      ),
    );

    expect(attempts.every((res) => res.status === 401)).toBe(true);
    expect(attempts.some((res) => res.status === 429)).toBe(false);
  });

  describe('login key', () => {
    const keyFor = (body, ip = '203.0.113.9') => loginRateLimitKey({ ip, body });

    /**
     * Per-target keying: spraying one password across many accounts is
     * throttled per account, and one colleague fatfingering a password does
     * not lock out everyone behind the same office NAT.
     */
    it('separates two accounts attacked from one address', () => {
      expect(keyFor({ email: 'a@example.com' })).not.toBe(keyFor({ email: 'b@example.com' }));
    });

    it('separates two addresses attacking one account', () => {
      expect(keyFor({ email: 'a@example.com' }, '203.0.113.9')).not.toBe(
        keyFor({ email: 'a@example.com' }, '198.51.100.4'),
      );
    });

    it('does not let case or whitespace buy a fresh quota', () => {
      expect(keyFor({ email: '  A@Example.COM ' })).toBe(keyFor({ email: 'a@example.com' }));
    });

    it('still produces a usable key when the body is absent or malformed', () => {
      [{}, { email: 42 }, { email: null }, undefined].forEach((body) => {
        expect(typeof keyFor(body)).toBe('string');
      });
    });

    /**
     * An IPv6 client controls its whole /64, so keying on the full address
     * would hand it a fresh quota for every attempt.
     */
    it('collapses an IPv6 address to its network prefix', () => {
      expect(keyFor({ email: 'a@example.com' }, '2001:db8::1')).toBe(
        keyFor({ email: 'a@example.com' }, '2001:db8::2'),
      );
    });
  });
});

describe('relay resilience', () => {
  /**
   * A failing pass must not kill the loop: the relay has to ride out a
   * transient database problem and carry on once it clears, rather than going
   * quiet until someone notices the backlog.
   */
  it('survives a pass that throws and resumes afterwards', async () => {
    await seedOutboxEvent();

    const spy = jest
      .spyOn(outboxService, 'claimBatch')
      .mockRejectedValueOnce(new Error('connection reset'));

    const { stop } = await start();
    let callCount = 0;

    try {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && fakeProducer.messages.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // Read the call count before restoring: mockRestore() discards it.
      callCount = spy.mock.calls.length;
    } finally {
      await stop();
      spy.mockRestore();
    }

    // At least twice: the pass that threw, and the one that recovered.
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(fakeProducer.messages).toHaveLength(1);
  });
});

describe('storage failure handling', () => {
  it('reports a missing object as absent rather than throwing', async () => {
    expect(await storageService.headObject('patents/1/nope/missing.pdf')).toBeNull();
  });

  /**
   * Object cleanup is best effort: the database is the source of truth, so a
   * failed delete is a storage cost, not a reason to fail the user's request.
   */
  it('swallows a delete failure instead of failing the caller', async () => {
    const spy = jest.spyOn(fakeStorage, 'send').mockRejectedValueOnce(new Error('storage down'));

    await expect(storageService.deleteObject('patents/1/x/y.pdf')).resolves.toBeUndefined();

    spy.mockRestore();
  });

  it('ignores a delete for a patent that never had a document', async () => {
    await expect(storageService.deleteObject(null)).resolves.toBeUndefined();
    await expect(storageService.deleteObject(undefined)).resolves.toBeUndefined();
  });
});
