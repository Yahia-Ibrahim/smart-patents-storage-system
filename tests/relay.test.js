const { prisma, createUser, createAdmin, login, approvedPatent } = require('./helpers');
const { fakeProducer } = require('./fakes');
const { start } = require('../src/workers/outboxRelay');

/**
 * The relay's polling loop.
 *
 * `publishBatch` is covered in outbox.test.js; this file drives `start()` — the
 * part that actually delivers events in production and that nothing exercised
 * before. Two of the worst bugs found in review (a hot spin at 100% CPU, and
 * duplicate publishing) lived in the loop's scheduling, not in the batch.
 */

const setup = async () => {
  await createUser({ email: 'inventor@example.com' });
  await createAdmin();

  return {
    token: (await login('inventor@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

/** Polls a condition instead of sleeping a fixed time, so the test is not racy. */
const waitFor = async (condition, { timeoutMs = 8000, intervalMs = 25 } = {}) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
};

/** Runs the relay loop for the duration of `body`, always stopping afterwards. */
const withRelay = async (body) => {
  const { stop } = await start();

  try {
    return await body();
  } finally {
    await stop();
  }
};

describe('outbox relay loop', () => {
  it('picks up an event written while it is running, without being prompted', async () => {
    const { token, adminToken } = await setup();

    await withRelay(async () => {
      const patent = await approvedPatent(token, adminToken);

      const delivered = await waitFor(() => fakeProducer.messages.length === 1);

      expect(delivered).toBe(true);
      expect(fakeProducer.messages[0].value.patent_id).toBe(patent.id);
    });

    const [event] = await prisma.outboxEvent.findMany();
    expect(event.publishedAt).not.toBeNull();
  });

  it('drains a backlog that existed before it started', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);
    await approvedPatent(token, adminToken, { publicationNumber: 'US1111111' });
    await approvedPatent(token, adminToken, { publicationNumber: 'US2222222' });

    await withRelay(() => waitFor(() => fakeProducer.messages.length === 3));

    expect(fakeProducer.messages).toHaveLength(3);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  /**
   * The loop used to schedule its next pass on rows *claimed* rather than rows
   * *published*, so a full batch whose head event always failed re-ran with a
   * zero delay — a busy loop that rewrote the same row thousands of times a
   * second. Here the single event always fails; the loop must back off to the
   * poll interval rather than burning attempts as fast as it can.
   */
  it('backs off instead of spinning when the head event keeps failing', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    fakeProducer.failNext = Number.MAX_SAFE_INTEGER;

    await withRelay(async () => {
      await waitFor(async () => {
        const [event] = await prisma.outboxEvent.findMany();
        return event.attempts >= 1;
      });
      // Long enough that an unthrottled loop would rack up a huge attempt
      // count; a correctly throttled one manages roughly one per interval.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    const [event] = await prisma.outboxEvent.findMany();
    expect(event.attempts).toBeGreaterThan(0);
    expect(event.attempts).toBeLessThan(20);
    expect(event.publishedAt).toBeNull();
  });

  it('stops cleanly and publishes nothing more afterwards', async () => {
    const { token, adminToken } = await setup();

    const { stop } = await start();
    await approvedPatent(token, adminToken);
    await waitFor(() => fakeProducer.messages.length === 1);
    await stop();

    const countAtStop = fakeProducer.messages.length;

    // An event written after stop() must sit untouched.
    await approvedPatent(token, adminToken, { publicationNumber: 'US3333333' });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(fakeProducer.messages).toHaveLength(countAtStop);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(1);
  });

  /**
   * A failing pass must not kill the loop — the relay has to survive a
   * transient database or broker problem and carry on once it clears.
   */
  it('recovers after a transient publish failure', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    fakeProducer.failNext = 1;

    await withRelay(() => waitFor(() => fakeProducer.messages.length === 1));

    const [event] = await prisma.outboxEvent.findMany();
    expect(event.publishedAt).not.toBeNull();
    expect(event.attempts).toBe(1);
    expect(fakeProducer.messages).toHaveLength(1);
  });

  it('does not re-publish events it already delivered', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    await withRelay(async () => {
      await waitFor(() => fakeProducer.messages.length === 1);
      // Give the loop several more passes over an outbox with nothing to do.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });

    expect(fakeProducer.messages).toHaveLength(1);
  });
});
