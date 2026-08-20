const { api, prisma, createUser, createAdmin, login, authHeader, createCategory } = require('./helpers');

const setup = async () => {
  await createUser({ email: 'user@example.com' });
  await createAdmin();

  return {
    token: (await login('user@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

describe('POST /api/categories', () => {
  it('lets an admin create a category', async () => {
    const { adminToken } = await setup();

    const res = await api()
      .post('/api/categories')
      .set(authHeader(adminToken))
      .send({ name: 'Biotechnology' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Biotechnology');
    expect(typeof res.body.data.id).toBe('string');
  });

  it('rejects a regular user with 403', async () => {
    const { token } = await setup();

    const res = await api().post('/api/categories').set(authHeader(token)).send({ name: 'Optics' });

    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await api().post('/api/categories').send({ name: 'Optics' });

    expect(res.status).toBe(401);
  });

  it('rejects a duplicate name', async () => {
    const { adminToken } = await setup();
    await createCategory('Optics');

    const res = await api().post('/api/categories').set(authHeader(adminToken)).send({ name: 'Optics' });

    expect(res.status).toBe(409);
  });

  /**
   * The unique index on CATEGORY.name is case-sensitive, so this would slip
   * through to the database and split the taxonomy in two.
   */
  it('rejects a duplicate name differing only in case', async () => {
    const { adminToken } = await setup();
    await createCategory('Optics');

    const res = await api().post('/api/categories').set(authHeader(adminToken)).send({ name: 'OPTICS' });

    expect(res.status).toBe(409);
  });

  it('rejects a name that is too short', async () => {
    const { adminToken } = await setup();

    const res = await api().post('/api/categories').set(authHeader(adminToken)).send({ name: 'A' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/categories', () => {
  it('returns categories alphabetically to any authenticated user', async () => {
    const { token } = await setup();
    await createCategory('Robotics');
    await createCategory('Aerospace');

    const res = await api().get('/api/categories').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.categories.map((c) => c.name)).toEqual(['Aerospace', 'Robotics']);
  });

  it('filters by search', async () => {
    const { token } = await setup();
    await createCategory('Robotics');
    await createCategory('Aerospace');

    const res = await api().get('/api/categories?search=robo').set(authHeader(token));

    expect(res.body.data.categories).toHaveLength(1);
    expect(res.body.data.categories[0].name).toBe('Robotics');
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/categories');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/categories/:id', () => {
  it('returns a category', async () => {
    const { token } = await setup();
    const category = await createCategory('Optics');

    const res = await api().get(`/api/categories/${category.id}`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Optics');
  });

  it('returns 404 for an unknown id', async () => {
    const { token } = await setup();

    const res = await api().get('/api/categories/9999').set(authHeader(token));

    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id with 400', async () => {
    const { token } = await setup();

    const res = await api().get('/api/categories/abc').set(authHeader(token));

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('renames a category', async () => {
    const { adminToken } = await setup();
    const category = await createCategory('Optic');

    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(authHeader(adminToken))
      .send({ name: 'Optics' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Optics');
  });

  it('allows renaming a category to its own current name', async () => {
    const { adminToken } = await setup();
    const category = await createCategory('Optics');

    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(authHeader(adminToken))
      .send({ name: 'Optics' });

    expect(res.status).toBe(200);
  });

  it('rejects a rename that collides with another category', async () => {
    const { adminToken } = await setup();
    await createCategory('Optics');
    const other = await createCategory('Robotics');

    const res = await api()
      .patch(`/api/categories/${other.id}`)
      .set(authHeader(adminToken))
      .send({ name: 'Optics' });

    expect(res.status).toBe(409);
  });

  it('rejects a regular user', async () => {
    const { token } = await setup();
    const category = await createCategory('Optics');

    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(authHeader(token))
      .send({ name: 'Optical' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes a category', async () => {
    const { adminToken } = await setup();
    const category = await createCategory('Optics');

    const res = await api().delete(`/api/categories/${category.id}`).set(authHeader(adminToken));

    expect(res.status).toBe(200);
    expect(await prisma.category.count()).toBe(0);
  });

  it('returns 404 for an unknown id', async () => {
    const { adminToken } = await setup();

    const res = await api().delete('/api/categories/9999').set(authHeader(adminToken));

    expect(res.status).toBe(404);
  });

  it('rejects a regular user', async () => {
    const { token } = await setup();
    const category = await createCategory('Optics');

    const res = await api().delete(`/api/categories/${category.id}`).set(authHeader(token));

    expect(res.status).toBe(403);
  });
});
