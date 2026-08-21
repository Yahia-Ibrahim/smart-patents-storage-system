const {
  api,
  prisma,
  createUser,
  createAdmin,
  login,
  authHeader,
  uploadDocument,
  createDraftPatent,
  createCategory,
  createInventor,
  PATENT_BODY,
} = require('./helpers');

/**
 * Category and inventor linking, and the edges of the submit guard.
 *
 * The database accepts almost all of this quite happily — an inventor order of
 * `[1, 7, 7]` is just three integers — so these rules exist only because the
 * service enforces them, which makes them worth pinning explicitly.
 */

const setup = async () => {
  await createUser({ email: 'inventor@example.com' });
  await createAdmin();

  return {
    token: (await login('inventor@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

const createWith = (token, overrides) =>
  uploadDocument(token).then((documentKey) =>
    api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey, ...overrides }),
  );

describe('inventor links', () => {
  it('defaults order to array position when none is given', async () => {
    const { token } = await setup();
    const first = await createInventor({ email: 'a@example.com', fullName: 'Alpha' });
    const second = await createInventor({ email: 'b@example.com', fullName: 'Beta' });

    const res = await createWith(token, {
      inventors: [{ inventorId: String(first.id) }, { inventorId: String(second.id) }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.inventors.map((i) => [i.fullName, i.order])).toEqual([
      ['Alpha', 1],
      ['Beta', 2],
    ]);
  });

  it('preserves an explicit order regardless of array position', async () => {
    const { token } = await setup();
    const first = await createInventor({ email: 'a@example.com', fullName: 'Alpha' });
    const second = await createInventor({ email: 'b@example.com', fullName: 'Beta' });

    const res = await createWith(token, {
      inventors: [
        { inventorId: String(first.id), order: 2 },
        { inventorId: String(second.id), order: 1 },
      ],
    });

    expect(res.body.data.inventors.map((i) => [i.fullName, i.order])).toEqual([
      ['Beta', 1],
      ['Alpha', 2],
    ]);
  });

  /**
   * "Some explicit, some positional" has no single obvious reading, so it is
   * refused rather than guessed at.
   */
  it('refuses a mix of explicit and implicit ordering', async () => {
    const { token } = await setup();
    const first = await createInventor({ email: 'a@example.com' });
    const second = await createInventor({ email: 'b@example.com' });

    const res = await createWith(token, {
      inventors: [{ inventorId: String(first.id), order: 1 }, { inventorId: String(second.id) }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/every inventor an explicit order, or none/);
  });

  const badOrders = [
    ['a gap', [1, 3]],
    ['a tie', [1, 1]],
    ['starting at zero', [0, 1]],
    ['a negative', [-1, 1]],
    ['starting above one', [2, 3]],
  ];

  it.each(badOrders)('rejects %s', async (_label, orders) => {
    const { token } = await setup();
    const first = await createInventor({ email: 'a@example.com' });
    const second = await createInventor({ email: 'b@example.com' });

    const res = await createWith(token, {
      inventors: [
        { inventorId: String(first.id), order: orders[0] },
        { inventorId: String(second.id), order: orders[1] },
      ],
    });

    expect(res.status).toBe(400);
    expect(await prisma.patent.count()).toBe(0);
  });

  it('names the duplicated inventor rather than failing vaguely', async () => {
    const { token } = await setup();
    const inventor = await createInventor();

    const res = await createWith(token, {
      inventors: [
        { inventorId: String(inventor.id), order: 1 },
        { inventorId: String(inventor.id), order: 2 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(new RegExp(String(inventor.id)));
  });

  it('names every unknown id, not just that something was missing', async () => {
    const { token } = await setup();

    const res = await createWith(token, {
      inventors: [{ inventorId: '4242' }, { inventorId: '4343' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/4242/);
    expect(res.body.error.message).toMatch(/4343/);
  });

  it('accepts an empty inventor list', async () => {
    const { token } = await setup();

    const res = await createWith(token, { inventors: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.inventors).toEqual([]);
  });

  it('replaces the whole set on update rather than appending', async () => {
    const { token } = await setup();
    const first = await createInventor({ email: 'a@example.com', fullName: 'Alpha' });
    const second = await createInventor({ email: 'b@example.com', fullName: 'Beta' });
    const created = await createWith(token, {
      inventors: [{ inventorId: String(first.id), order: 1 }],
    });

    const res = await api()
      .patch(`/api/patents/${created.body.data.id}`)
      .set(authHeader(token))
      .send({ inventors: [{ inventorId: String(second.id), order: 1 }] });

    expect(res.body.data.inventors.map((i) => i.fullName)).toEqual(['Beta']);
    expect(await prisma.patentInventor.count()).toBe(1);
  });

  it('leaves existing links untouched when inventors are not mentioned', async () => {
    const { token } = await setup();
    const inventor = await createInventor();
    const created = await createWith(token, {
      inventors: [{ inventorId: String(inventor.id), order: 1 }],
    });

    const res = await api()
      .patch(`/api/patents/${created.body.data.id}`)
      .set(authHeader(token))
      .send({ jurisdiction: 'GB' });

    expect(res.body.data.inventors).toHaveLength(1);
  });
});

describe('category links', () => {
  /**
   * Silently deduplicating hides a client that built its request wrong until
   * someone notices the returned count does not match what they sent.
   */
  it('rejects a repeated category id instead of quietly deduplicating', async () => {
    const { token } = await setup();
    const category = await createCategory('Optics');

    const res = await createWith(token, {
      categoryIds: [String(category.id), String(category.id)],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Duplicate category/);
  });

  it('names every unknown category id', async () => {
    const { token } = await setup();

    const res = await createWith(token, { categoryIds: ['777', '888'] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/777/);
    expect(res.body.error.message).toMatch(/888/);
  });

  it('accepts an empty category list', async () => {
    const { token } = await setup();

    const res = await createWith(token, { categoryIds: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.categories).toEqual([]);
  });

  it('clears categories when given an empty array on update', async () => {
    const { token } = await setup();
    const category = await createCategory('Optics');
    const created = await createWith(token, { categoryIds: [String(category.id)] });

    const res = await api()
      .patch(`/api/patents/${created.body.data.id}`)
      .set(authHeader(token))
      .send({ categoryIds: [] });

    expect(res.body.data.categories).toEqual([]);
    expect(await prisma.patentCategory.count()).toBe(0);
  });

  it('survives deleting a category that a patent uses', async () => {
    const { token, adminToken } = await setup();
    const category = await createCategory('Optics');
    const created = await createWith(token, { categoryIds: [String(category.id)] });

    const del = await api().delete(`/api/categories/${category.id}`).set(authHeader(adminToken));
    const after = await api()
      .get(`/api/patents/${created.body.data.id}`)
      .set(authHeader(token));

    expect(del.status).toBe(200);
    // The link goes; the patent must not.
    expect(after.status).toBe(200);
    expect(after.body.data.categories).toEqual([]);
  });
});

describe('submit guard', () => {
  /**
   * A patent with no document cannot be reviewed. This is a state problem, not
   * a malformed request, so it is a 409 rather than a 400.
   */
  it('refuses to submit a patent with no document', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await prisma.patent.update({
      where: { id: BigInt(draft.id) },
      data: { documentKey: null },
    });

    const res = await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/without an uploaded document/);
  });

  it('refuses to submit a patent belonging to someone else', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await createUser({ email: 'other@example.com' });
    const other = await login('other@example.com');

    const res = await api()
      .post(`/api/patents/${draft.id}/submit`)
      .set(authHeader(other.accessToken))
      .send();

    expect(res.status).toBe(403);
  });

  it('returns 404 for a patent that does not exist', async () => {
    const { token } = await setup();

    const res = await api().post('/api/patents/999999/submit').set(authHeader(token)).send();

    expect(res.status).toBe(404);
  });
});
