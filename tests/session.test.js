const { api, prisma, createUser, login, authHeader, VALID_PASSWORD } = require('./helpers');
const { hashRefreshToken } = require('../src/utils/helpers');

describe('POST /api/users/refresh', () => {
  it('exchanges a refresh token for a new pair', async () => {
    await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    const res = await api().post('/api/users/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('revokes the old token when rotating', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    await api().post('/api/users/refresh').send({ refreshToken });

    const old = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });

    expect(old.rotatedAt).not.toBeNull();
    expect(old.revokedAt).not.toBeNull();

    const active = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(active).toHaveLength(1);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await api().post('/api/users/refresh').send({ refreshToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });

  it('rejects a reused token and revokes every session for that user', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    // Legitimate rotation.
    const rotated = await api().post('/api/users/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);

    // An attacker replays the token the real client already exchanged.
    const replay = await api().post('/api/users/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);

    // The replay is evidence of theft, so the token the real client is holding
    // must be dead too, forcing a fresh login.
    const stillValid = await api()
      .post('/api/users/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken });
    expect(stillValid.status).toBe(401);

    const active = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(active).toHaveLength(0);
  });

  it('rejects an expired refresh token', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api().post('/api/users/refresh').send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
    expect(user).toBeDefined();
  });

  it('rejects a revoked refresh token', async () => {
    await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      data: { revokedAt: new Date() },
    });

    const res = await api().post('/api/users/refresh').send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('requires a refresh token in the body', async () => {
    const res = await api().post('/api/users/refresh').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/users/logout', () => {
  it('revokes only the supplied session', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const first = await login('ada@example.com');
    const second = await login('ada@example.com');

    const res = await api()
      .post('/api/users/logout')
      .set(authHeader(first.accessToken))
      .send({ refreshToken: first.refreshToken });

    expect(res.status).toBe(200);

    // The other device stays logged in.
    const other = await api().post('/api/users/refresh').send({ refreshToken: second.refreshToken });
    expect(other.status).toBe(200);

    const dead = await api().post('/api/users/refresh').send({ refreshToken: first.refreshToken });
    expect(dead.status).toBe(401);
    expect(user).toBeDefined();
  });

  it('revokes every session when no token is supplied', async () => {
    await createUser({ email: 'ada@example.com' });
    const first = await login('ada@example.com');
    const second = await login('ada@example.com');

    const res = await api().post('/api/users/logout').set(authHeader(first.accessToken)).send({});

    expect(res.status).toBe(200);

    for (const token of [first.refreshToken, second.refreshToken]) {
      const attempt = await api().post('/api/users/refresh').send({ refreshToken: token });
      expect(attempt.status).toBe(401);
    }
  });

  it('cannot revoke another user`s session', async () => {
    await createUser({ email: 'ada@example.com' });
    await createUser({ email: 'eve@example.com' });
    const ada = await login('ada@example.com');
    const eve = await login('eve@example.com');

    // Eve presents Ada's refresh token with her own access token.
    const res = await api()
      .post('/api/users/logout')
      .set(authHeader(eve.accessToken))
      .send({ refreshToken: ada.refreshToken });

    expect(res.status).toBe(200);

    // Ada's session must survive: logout is scoped to the caller's own tokens.
    const adaStillValid = await api()
      .post('/api/users/refresh')
      .send({ refreshToken: ada.refreshToken });
    expect(adaStillValid.status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/users/logout').send({});

    expect(res.status).toBe(401);
  });
});

describe('password change invalidates sessions', () => {
  it('revokes all refresh tokens when the password changes', async () => {
    await createUser({ email: 'ada@example.com' });
    const session = await login('ada@example.com');

    const res = await api()
      .put('/api/users/me/password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'BrandNewPass1' });

    expect(res.status).toBe(200);

    const attempt = await api()
      .post('/api/users/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(attempt.status).toBe(401);
  });
});
