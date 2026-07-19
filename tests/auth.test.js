const { api, prisma, createUser, login, VALID_PASSWORD, ROLES } = require('./helpers');

describe('POST /api/users/signup', () => {
  it('creates a user and returns a token pair', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: ROLES.USER,
    });
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
  });

  it('never exposes the password hash', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'ada@example.com', password: VALID_PASSWORD });

    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('serialises the BigInt id as a string', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'ada@example.com', password: VALID_PASSWORD });

    expect(typeof res.body.data.user.id).toBe('string');
  });

  it('stores the password as a bcrypt hash, not plaintext', async () => {
    await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'ada@example.com', password: VALID_PASSWORD });

    const stored = await prisma.user.findUnique({ where: { email: 'ada@example.com' } });

    expect(stored.passwordHash).not.toBe(VALID_PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2b\$12\$/);
  });

  it('ignores a role supplied by the client and always creates a plain user', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: VALID_PASSWORD, role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe(ROLES.USER);

    const stored = await prisma.user.findUnique({ where: { email: 'sneaky@example.com' } });
    expect(stored.role).toBe(ROLES.USER);
  });

  it('lowercases the email but preserves dots and subaddressing', async () => {
    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'A.D.A+patents@Example.COM', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('a.d.a+patents@example.com');
  });

  it('treats dotted gmail variants as distinct accounts', async () => {
    const first = await api()
      .post('/api/users/signup')
      .send({ name: 'John Dotted', email: 'j.o.h.n@gmail.com', password: VALID_PASSWORD });
    const second = await api()
      .post('/api/users/signup')
      .send({ name: 'John Plain', email: 'john@gmail.com', password: VALID_PASSWORD });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: 'taken@example.com' });

    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'taken@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await createUser({ email: 'taken@example.com' });

    const res = await api()
      .post('/api/users/signup')
      .send({ name: 'Ada', email: 'TAKEN@Example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(409);
  });

  describe('validation', () => {
    const cases = [
      ['missing name', { email: 'a@b.com', password: VALID_PASSWORD }, 'name'],
      ['missing email', { name: 'Ada', password: VALID_PASSWORD }, 'email'],
      ['missing password', { name: 'Ada', email: 'a@b.com' }, 'password'],
      ['malformed email', { name: 'Ada', email: 'not-an-email', password: VALID_PASSWORD }, 'email'],
      ['short password', { name: 'Ada', email: 'a@b.com', password: 'Ab1' }, 'password'],
      ['password without uppercase', { name: 'Ada', email: 'a@b.com', password: 'passw0rdtest' }, 'password'],
      ['password without digit', { name: 'Ada', email: 'a@b.com', password: 'PasswordTest' }, 'password'],
      ['name too short', { name: 'A', email: 'a@b.com', password: VALID_PASSWORD }, 'name'],
    ];

    it.each(cases)('rejects %s with 400', async (_label, body, field) => {
      const res = await api().post('/api/users/signup').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.field)).toContain(field);
    });

    it('rejects a password longer than bcrypt`s 72-byte limit', async () => {
      const res = await api()
        .post('/api/users/signup')
        .send({ name: 'Ada', email: 'a@b.com', password: `Aa1${'x'.repeat(80)}` });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field)).toContain('password');
    });
  });
});

describe('POST /api/users/login', () => {
  it('returns a token pair for valid credentials', async () => {
    await createUser({ email: 'ada@example.com' });

    const res = await api()
      .post('/api/users/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
  });

  it('accepts a differently-cased email', async () => {
    await createUser({ email: 'ada@example.com' });

    const res = await api()
      .post('/api/users/login')
      .send({ email: 'ADA@Example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with 401', async () => {
    await createUser({ email: 'ada@example.com' });

    const res = await api()
      .post('/api/users/login')
      .send({ email: 'ada@example.com', password: 'WrongPassw0rd' });

    expect(res.status).toBe(401);
  });

  it('gives an identical response for unknown email and wrong password', async () => {
    await createUser({ email: 'ada@example.com' });

    const wrongPassword = await api()
      .post('/api/users/login')
      .send({ email: 'ada@example.com', password: 'WrongPassw0rd' });
    const unknownEmail = await api()
      .post('/api/users/login')
      .send({ email: 'nobody@example.com', password: 'WrongPassw0rd' });

    // Any difference here would let an attacker enumerate registered emails.
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('does not issue a token for a non-existent user', async () => {
    const res = await api()
      .post('/api/users/login')
      .send({ email: 'nobody@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('records a refresh token in the database on login', async () => {
    const user = await createUser({ email: 'ada@example.com' });
    const { refreshToken } = await login('ada@example.com');

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });

    expect(stored).toHaveLength(1);
    // The raw token must never be stored, only its hash.
    expect(stored[0].tokenHash).not.toBe(refreshToken);
    expect(stored[0].tokenHash).toHaveLength(64);
  });
});
