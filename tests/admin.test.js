const { api, prisma, createUser, createAdmin, login, authHeader, VALID_PASSWORD, ROLES } = require('./helpers');
const { BCRYPT_COST } = require('../src/utils/helpers');

describe('POST /api/users/admins', () => {
  it('lets an admin create another admin', async () => {
    const admin = await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Second Admin', email: 'admin2@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'admin2@example.com', role: ROLES.ADMIN });

    const stored = await prisma.user.findUnique({ where: { email: 'admin2@example.com' } });
    expect(stored.role).toBe(ROLES.ADMIN);
    // Audit trail: the creating admin is recorded.
    expect(stored.createdBy).toBe(admin.id);
  });

  it('records the creating admin in the response createdBy', async () => {
    const admin = await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Second Admin', email: 'admin2@example.com', password: VALID_PASSWORD });

    expect(res.body.data.createdBy).toBe(String(admin.id));
  });

  it('hashes the new admin`s password with bcrypt', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Second Admin', email: 'admin2@example.com', password: VALID_PASSWORD });

    const stored = await prisma.user.findUnique({ where: { email: 'admin2@example.com' } });
    // A bcrypt hash at the configured work factor. Compared against
    // BCRYPT_COST rather than a literal 12 because tests deliberately run a
    // cheaper factor; what this asserts is that the password went through
    // bcrypt at all, not which factor was used.
    expect(stored.passwordHash.slice(0, 7)).toBe(
      `$2b$${String(BCRYPT_COST).padStart(2, '0')}$`,
    );
    expect(stored.passwordHash).not.toBe(VALID_PASSWORD);
  });

  it('never exposes the password hash in the response', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Second Admin', email: 'admin2@example.com', password: VALID_PASSWORD });

    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  it('rejects a regular user with 403', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Sneaky Admin', email: 'sneaky@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(403);

    const created = await prisma.user.findUnique({ where: { email: 'sneaky@example.com' } });
    expect(created).toBeNull();
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await api()
      .post('/api/users/admins')
      .send({ name: 'Admin', email: 'admin2@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('rejects a duplicate email with 409', async () => {
    await createAdmin({ email: 'admin@example.com' });
    await createUser({ email: 'taken@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api()
      .post('/api/users/admins')
      .set(authHeader(accessToken))
      .send({ name: 'Admin', email: 'taken@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(409);
  });

  it.each([
    ['missing name', { email: 'a@b.com', password: VALID_PASSWORD }],
    ['missing email', { name: 'Admin', password: VALID_PASSWORD }],
    ['weak password', { name: 'Admin', email: 'a@b.com', password: 'weak' }],
  ])('rejects %s with 400', async (_label, body) => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().post('/api/users/admins').set(authHeader(accessToken)).send(body);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/users (admin list)', () => {
  it('returns a paginated list for an admin', async () => {
    await createAdmin({ email: 'admin@example.com' });
    await createUser({ email: 'ada@example.com' });
    await createUser({ email: 'grace@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data.users).toHaveLength(3);
    expect(res.body.data.pagination).toMatchObject({ total: 3, page: 1 });
  });

  it('filters by role', async () => {
    await createAdmin({ email: 'admin@example.com' });
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users?role=admin').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].role).toBe(ROLES.ADMIN);
  });

  it('searches by name or email', async () => {
    await createAdmin({ email: 'admin@example.com' });
    await createUser({ name: 'Grace Hopper', email: 'grace@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users?search=grace').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].email).toBe('grace@example.com');
  });

  it('paginates', async () => {
    await createAdmin({ email: 'admin@example.com' });
    for (let i = 0; i < 5; i += 1) {
      await createUser({ email: `user${i}@example.com` });
    }
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users?page=1&limit=2').set(authHeader(accessToken));

    expect(res.body.data.users).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({ total: 6, limit: 2, totalPages: 3 });
  });

  it('rejects a regular user with 403', async () => {
    await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get('/api/users').set(authHeader(accessToken));

    expect(res.status).toBe(403);
  });

  it('rejects an invalid limit', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users?limit=9999').set(authHeader(accessToken));

    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:id (admin)', () => {
  it('returns a user by id for an admin', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const target = await createUser({ email: 'ada@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get(`/api/users/${target.id}`).set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('ada@example.com');
  });

  it('returns 404 for an unknown id', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users/999999').set(authHeader(accessToken));

    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id with 400', async () => {
    await createAdmin({ email: 'admin@example.com' });
    const { accessToken } = await login('admin@example.com');

    const res = await api().get('/api/users/not-a-number').set(authHeader(accessToken));

    expect(res.status).toBe(400);
  });

  it('rejects a regular user with 403', async () => {
    await createUser({ email: 'ada@example.com' });
    const target = await createUser({ email: 'grace@example.com' });
    const { accessToken } = await login('ada@example.com');

    const res = await api().get(`/api/users/${target.id}`).set(authHeader(accessToken));

    expect(res.status).toBe(403);
  });
});

describe('admin seeding rules', () => {
  it('admins cannot be created through public signup', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Wannabe', email: 'wannabe@example.com', password: VALID_PASSWORD, role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe(ROLES.USER);
  });
});
