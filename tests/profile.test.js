const { api, prisma, createUser, login, authHeader, VALID_PASSWORD } = require('./helpers');

describe('GET /api/users/me', () => {
  it('returns the caller`s profile', async () => {
    await createUser({ name: 'Ada Lovelace', email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users/me').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', role: 'user' });
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('includes a linked inventor profile when one exists', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    await prisma.inventor.create({
      data: {
        userId: user.id,
        fullName: 'Ada Lovelace',
        email: 'ada.inventor@example.com',
        organization: 'Analytical Engines Ltd',
      },
    });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users/me').set(authHeader(accessToken));

    expect(res.body.data.inventorProfile).toMatchObject({
      fullName: 'Ada Lovelace',
      organization: 'Analytical Engines Ltd',
    });
  });

  it('returns null for inventorProfile when none is linked', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users/me').set(authHeader(accessToken));

    expect(res.body.data.inventorProfile).toBeNull();
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/users/me');

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates the name', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ name: 'Ada King' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Ada King');
  });

  it('updates the email, lowercased', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ email: 'NEW.Address@Example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('new.address@example.com');
  });

  it('rejects an email already taken by someone else with 409', async () => {
    await createUser({ email: 'ada@example.com' });
    await createUser({ email: 'taken@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ email: 'taken@example.com' });

    expect(res.status).toBe(409);
  });

  it('allows submitting your own unchanged email', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ email: 'ada@example.com' });

    expect(res.status).toBe(200);
  });

  it('cannot change role through the profile endpoint', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ name: 'Ada', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('user');

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.role).toBe('user');
  });

  it('cannot change the password hash through the profile endpoint', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const before = user.passwordHash;
    const { accessToken } = await login('ada@example.com');

    await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ name: 'Ada', passwordHash: 'injected' });

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.passwordHash).toBe(before);
  });

  it('rejects an empty body', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().patch('/api/users/me').set(authHeader(accessToken)).send({});

    expect(res.status).toBe(400);
  });

  it('rejects an invalid email', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .patch('/api/users/me')
      .set(authHeader(accessToken))
      .send({ email: 'nope' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await api().patch('/api/users/me').send({ name: 'Ada' });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/users/me/password', () => {
  it('changes the password and lets the user log in with the new one', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'BrandNewPass1' });

    expect(res.status).toBe(200);

    const relogin = await api()
      .post('/api/users/login')
      .send({ email: 'ada@example.com', password: 'BrandNewPass1' });
    expect(relogin.status).toBe(200);
  });

  it('rejects the old password after a change', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'BrandNewPass1' });

    const relogin = await api()
      .post('/api/users/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    expect(relogin.status).toBe(401);
  });

  it('rejects a wrong current password with 401', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: 'NotMyPassw0rd', newPassword: 'BrandNewPass1' });

    expect(res.status).toBe(401);
  });

  it('does not change the stored hash when the current password is wrong', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const before = user.passwordHash;
    const { accessToken } = await login('ada@example.com');

    await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: 'NotMyPassw0rd', newPassword: 'BrandNewPass1' });

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.passwordHash).toBe(before);
  });

  it('rejects a weak new password', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'weak' });

    expect(res.status).toBe(400);
  });

  it('rejects reusing the current password as the new one', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .put('/api/users/me/password')
      .set(authHeader(accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword: VALID_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await api()
      .put('/api/users/me/password')
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'BrandNewPass1' });

    expect(res.status).toBe(401);
  });
});
