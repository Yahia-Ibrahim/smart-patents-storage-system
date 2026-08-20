const {
  api,
  prisma,
  createUser,
  createAdmin,
  login,
  authHeader,
  createInventor,
  createDraftPatent,
} = require('./helpers');

const setup = async () => {
  const user = await createUser({ email: 'user@example.com' });
  const admin = await createAdmin();

  return {
    user,
    admin,
    token: (await login('user@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

const VALID = { fullName: 'Grace Hopper', email: 'grace@example.com', organization: 'US Navy' };

describe('POST /api/inventors', () => {
  it('creates an inventor with no linked account', async () => {
    const { token } = await setup();

    const res = await api().post('/api/inventors').set(authHeader(token)).send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data.fullName).toBe('Grace Hopper');
    expect(res.body.data.linkedUser).toBeNull();
  });

  it('links the inventor to the caller when asked', async () => {
    const { user, token } = await setup();

    const res = await api()
      .post('/api/inventors')
      .set(authHeader(token))
      .send({ ...VALID, linkToMe: true });

    expect(res.status).toBe(201);
    expect(res.body.data.linkedUser.id).toBe(String(user.id));
  });

  it('refuses to link a second inventor to the same account', async () => {
    const { token } = await setup();
    await api()
      .post('/api/inventors')
      .set(authHeader(token))
      .send({ ...VALID, linkToMe: true });

    const res = await api()
      .post('/api/inventors')
      .set(authHeader(token))
      .send({ fullName: 'Alter Ego', email: 'alter@example.com', linkToMe: true });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already linked/);
  });

  it('rejects a duplicate email', async () => {
    const { token } = await setup();
    await createInventor({ email: 'grace@example.com' });

    const res = await api().post('/api/inventors').set(authHeader(token)).send(VALID);

    expect(res.status).toBe(409);
  });

  it('lowercases the email', async () => {
    const { token } = await setup();

    const res = await api()
      .post('/api/inventors')
      .set(authHeader(token))
      .send({ ...VALID, email: 'GRACE@Example.COM' });

    // The create response echoes the address the caller just supplied.
    expect(res.body.data.email).toBe('grace@example.com');
    expect((await prisma.inventor.findFirst()).email).toBe('grace@example.com');
  });

  /**
   * Any signed-up user can search the inventor directory. Returning addresses
   * there would make "create an account" a way to download the user and admin
   * email directory.
   */
  it('hides inventor emails from an unrelated user on read', async () => {
    const { token } = await setup();
    await createInventor({ email: 'private@example.com' });

    const list = await api().get('/api/inventors').set(authHeader(token));
    const one = await api()
      .get(`/api/inventors/${list.body.data.inventors[0].id}`)
      .set(authHeader(token));

    expect(list.body.data.inventors[0].email).toBeUndefined();
    expect(list.body.data.inventors[0].fullName).toBeTruthy();
    expect(one.body.data.email).toBeUndefined();
  });

  it('shows inventor emails to an admin', async () => {
    const { adminToken } = await setup();
    await createInventor({ email: 'private@example.com' });

    const res = await api().get('/api/inventors').set(authHeader(adminToken));

    expect(res.body.data.inventors[0].email).toBe('private@example.com');
  });

  it('shows a linked user their own inventor email', async () => {
    const { user, token } = await setup();
    const inventor = await createInventor({ userId: user.id, email: 'mine@example.com' });

    const res = await api().get(`/api/inventors/${inventor.id}`).set(authHeader(token));

    expect(res.body.data.email).toBe('mine@example.com');
  });

  it('rejects an invalid email', async () => {
    const { token } = await setup();

    const res = await api()
      .post('/api/inventors')
      .set(authHeader(token))
      .send({ ...VALID, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/inventors').send(VALID);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/inventors', () => {
  it('paginates', async () => {
    const { token } = await setup();
    await createInventor({ email: 'a@example.com', fullName: 'Alpha' });
    await createInventor({ email: 'b@example.com', fullName: 'Beta' });
    await createInventor({ email: 'c@example.com', fullName: 'Gamma' });

    const res = await api().get('/api/inventors?page=2&limit=2').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.inventors).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });

  it('searches by name, email, or organization', async () => {
    const { token } = await setup();
    await createInventor({ email: 'a@example.com', fullName: 'Alpha', organization: 'Acme' });
    await createInventor({ email: 'b@example.com', fullName: 'Beta', organization: 'Umbrella' });

    const byName = await api().get('/api/inventors?search=alph').set(authHeader(token));
    const byOrg = await api().get('/api/inventors?search=umbrella').set(authHeader(token));

    expect(byName.body.data.inventors).toHaveLength(1);
    expect(byOrg.body.data.inventors[0].fullName).toBe('Beta');
  });

  it('rejects an out-of-range limit', async () => {
    const { token } = await setup();

    const res = await api().get('/api/inventors?limit=500').set(authHeader(token));

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/inventors/:id', () => {
  it('lets the linked user edit their own profile', async () => {
    const { user, token } = await setup();
    const inventor = await createInventor({ userId: user.id });

    const res = await api()
      .patch(`/api/inventors/${inventor.id}`)
      .set(authHeader(token))
      .send({ organization: 'New Employer' });

    expect(res.status).toBe(200);
    expect(res.body.data.organization).toBe('New Employer');
  });

  it('lets an admin edit any inventor', async () => {
    const { adminToken } = await setup();
    const inventor = await createInventor();

    const res = await api()
      .patch(`/api/inventors/${inventor.id}`)
      .set(authHeader(adminToken))
      .send({ fullName: 'Corrected Name' });

    expect(res.status).toBe(200);
  });

  it('refuses an unrelated user', async () => {
    const { token } = await setup();
    const inventor = await createInventor();

    const res = await api()
      .patch(`/api/inventors/${inventor.id}`)
      .set(authHeader(token))
      .send({ fullName: 'Not Mine To Change' });

    expect(res.status).toBe(403);
  });

  it('rejects an email that belongs to another inventor', async () => {
    const { adminToken } = await setup();
    await createInventor({ email: 'taken@example.com' });
    const inventor = await createInventor({ email: 'mine@example.com' });

    const res = await api()
      .patch(`/api/inventors/${inventor.id}`)
      .set(authHeader(adminToken))
      .send({ email: 'taken@example.com' });

    expect(res.status).toBe(409);
  });

  it('rejects an empty body', async () => {
    const { adminToken } = await setup();
    const inventor = await createInventor();

    const res = await api()
      .patch(`/api/inventors/${inventor.id}`)
      .set(authHeader(adminToken))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/inventors/:id', () => {
  it('deletes an uncredited inventor', async () => {
    const { adminToken } = await setup();
    const inventor = await createInventor();

    const res = await api().delete(`/api/inventors/${inventor.id}`).set(authHeader(adminToken));

    expect(res.status).toBe(200);
    expect(await prisma.inventor.count()).toBe(0);
  });

  /**
   * PATENT_INVENTOR cascades on delete, so without the guard this would
   * silently rewrite the authorship of an existing patent.
   */
  it('refuses to delete an inventor credited on a patent', async () => {
    const { adminToken, token } = await setup();
    const inventor = await createInventor();
    await createDraftPatent(token, { inventors: [{ inventorId: String(inventor.id), order: 1 }] });

    const res = await api().delete(`/api/inventors/${inventor.id}`).set(authHeader(adminToken));

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/credited on 1 patent/);
    expect(await prisma.inventor.count()).toBe(1);
  });

  it('rejects a regular user', async () => {
    const { token } = await setup();
    const inventor = await createInventor();

    const res = await api().delete(`/api/inventors/${inventor.id}`).set(authHeader(token));

    expect(res.status).toBe(403);
  });
});
