const jwt = require('jsonwebtoken');
const { api, createUser, createAdmin, login, authHeader, ROLES } = require('./helpers');

const JWT_SECRET = process.env.JWT_SECRET;

describe('authentication middleware', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await api().get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a non-Bearer Authorization scheme', async () => {
    const res = await api().get('/api/users/me').set({ Authorization: 'Basic dXNlcjpwYXNz' });

    expect(res.status).toBe(401);
  });

  it('rejects an empty Bearer token', async () => {
    const res = await api().get('/api/users/me').set({ Authorization: 'Bearer ' });

    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await api().get('/api/users/me').set(authHeader('not.a.jwt'));

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ role: ROLES.ADMIN }, 'the-wrong-secret', { subject: '1' });

    const res = await api().get('/api/users/me').set(authHeader(forged));

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ role: ROLES.USER }, JWT_SECRET, { subject: '1', expiresIn: '-1s' });

    const res = await api().get('/api/users/me').set(authHeader(expired));

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('rejects a token with no role claim', async () => {
    const res = await api()
      .get('/api/users/me')
      .set(authHeader(jwt.sign({}, JWT_SECRET, { subject: '1' })));

    expect(res.status).toBe(401);
  });

  it('rejects a token whose subject is not a numeric id', async () => {
    const res = await api()
      .get('/api/users/me')
      .set(authHeader(jwt.sign({ role: ROLES.USER }, JWT_SECRET, { subject: 'not-a-number' })));

    expect(res.status).toBe(401);
  });

  it('resolves the caller from the token subject', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users/me').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    // The bug this guards: userId used to arrive as null, silently.
    expect(res.body.data.id).toBe(String(user.id));
    expect(res.body.data.email).toBe('ada@example.com');
  });
});

describe('role-based authorization', () => {
  const adminOnly = [
    ['POST', '/api/users/admins'],
    ['GET', '/api/users'],
    ['GET', '/api/users/1'],
  ];

  it.each(adminOnly)('%s %s rejects an anonymous caller with 401', async (method, path) => {
    const res = await api()[method.toLowerCase()](path).send({});

    expect(res.status).toBe(401);
  });

  it.each(adminOnly)('%s %s rejects a regular user with 403', async (method, path) => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()[method.toLowerCase()](path).set(authHeader(accessToken)).send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin through', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users').set(authHeader(accessToken));

    expect(res.status).toBe(200);
  });

  it('does not let a user escalate by claiming admin in a forged token', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    // Correct secret, but the client cannot mint this: it comes from the server.
    // What a client *can* do is edit the payload, which breaks the signature.
    const [header, payload] = jwt.sign({ role: ROLES.USER }, JWT_SECRET, {
      subject: String(user.id),
    }).split('.');
    const tampered = Buffer.from(JSON.stringify({ role: 'admin', sub: String(user.id) })).toString(
      'base64url',
    );

    const res = await api().get('/api/users').set(authHeader(`${header}.${tampered}.${payload}`));

    expect(res.status).toBe(401);
  });

  it('honours the role in a validly signed token', async () => {
    const user = await createUser({ email: 'ada@example.com', role: ROLES.ADMIN });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(user.role).toBe(ROLES.ADMIN);
  });
});

describe('public endpoints', () => {
  it.each([
    ['POST', '/api/users/signup'],
    ['POST', '/api/users/login'],
    ['POST', '/api/users/refresh'],
  ])('%s %s does not require authentication', async (method, path) => {
    const res = await api()[method.toLowerCase()](path).send({});

    // 400 (validation) proves the request reached the handler rather than
    // being turned away by an auth guard.
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400);
  });

  it('GET /health is public', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
  });
});
