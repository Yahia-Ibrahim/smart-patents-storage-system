const {
  api,
  prisma,
  createUser,
  createAdmin,
  login,
  authHeader,
  uploadDocument,
  createDraftPatent,
  approvedPatent,
  createCategory,
  createInventor,
  PATENT_BODY,
} = require('./helpers');
const { fakeStorage } = require('./fakes');

const setup = async () => {
  const user = await createUser({ email: 'inventor@example.com' });
  const admin = await createAdmin();
  const userTokens = await login('inventor@example.com');
  const adminTokens = await login('admin@example.com');

  return { user, admin, token: userTokens.accessToken, adminToken: adminTokens.accessToken };
};

describe('POST /api/patents/uploads', () => {
  it('issues a presigned target scoped to the caller', async () => {
    const { user, token } = await setup();

    const res = await api()
      .post('/api/patents/uploads')
      .set(authHeader(token))
      .send({ filename: 'spec.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.uploadUrl).toContain('fake-storage.test/put');
    expect(res.body.data.objectKey).toMatch(new RegExp(`^patents/${user.id}/`));
    expect(res.body.data.expiresAt).toBeDefined();
  });

  it('sanitises a traversal attempt in the filename', async () => {
    const { token } = await setup();

    const res = await api()
      .post('/api/patents/uploads')
      .set(authHeader(token))
      .send({ filename: '../../../etc/passwd', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.objectKey).not.toContain('..');
    expect(res.body.data.objectKey).toMatch(/\/passwd$/);
  });

  it('rejects a disallowed content type', async () => {
    const { token } = await setup();

    const res = await api()
      .post('/api/patents/uploads')
      .set(authHeader(token))
      .send({ filename: 'evil.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unsupported content type/);
  });

  it('requires authentication', async () => {
    const res = await api()
      .post('/api/patents/uploads')
      .send({ filename: 'spec.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/patents', () => {
  it('creates a draft owned by the caller', async () => {
    const { user, token } = await setup();
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.submittedBy).toBe(String(user.id));
    expect(res.body.data.hasDocument).toBe(true);
  });

  it('links categories and inventors with an explicit order', async () => {
    const { token } = await setup();
    const category = await createCategory('Software');
    const first = await createInventor({ email: 'first@example.com', fullName: 'First Inventor' });
    const second = await createInventor({ email: 'second@example.com', fullName: 'Second Inventor' });
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({
        ...PATENT_BODY,
        documentKey,
        categoryIds: [String(category.id)],
        inventors: [
          { inventorId: String(second.id), order: 2 },
          { inventorId: String(first.id), order: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.categories).toEqual([{ id: String(category.id), name: 'Software' }]);
    expect(res.body.data.inventors.map((i) => i.order)).toEqual([1, 2]);
    expect(res.body.data.inventors[0].fullName).toBe('First Inventor');
  });

  it('rejects a documentKey that was never uploaded', async () => {
    const { user, token } = await setup();
    const key = `patents/${user.id}/00000000-0000-4000-8000-000000000000/ghost.pdf`;

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey: key });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No uploaded document/);
  });

  it("rejects another user's documentKey", async () => {
    const { token } = await setup();
    await createUser({ email: 'other@example.com' });
    const otherTokens = await login('other@example.com');
    const stolenKey = await uploadDocument(otherTokens.accessToken);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey: stolenKey });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not issued to you/);
  });

  it('rejects an oversized upload and removes the object', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token, { size: 100 * 1024 * 1024 });

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/maximum is/);
    expect(fakeStorage.objects.has(documentKey)).toBe(false);
  });

  it('rejects an unknown category id', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey, categoryIds: ['9999'] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unknown category id/);
  });

  it('rejects a non-contiguous inventor ordering', async () => {
    const { token } = await setup();
    const inventor = await createInventor();
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({
        ...PATENT_BODY,
        documentKey,
        inventors: [{ inventorId: String(inventor.id), order: 5 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/contiguous/);
  });

  it('rejects the same inventor twice', async () => {
    const { token } = await setup();
    const inventor = await createInventor();
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({
        ...PATENT_BODY,
        documentKey,
        inventors: [
          { inventorId: String(inventor.id), order: 1 },
          { inventorId: String(inventor.id), order: 2 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot be listed twice/);
  });

  it('rejects a duplicate publication number', async () => {
    const { token } = await setup();
    await createDraftPatent(token, { publicationNumber: 'US1234567' });
    const documentKey = await uploadDocument(token);

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey, publicationNumber: 'US1234567' });

    expect(res.status).toBe(409);
  });

  describe('validation', () => {
    const cases = [
      ['missing title', { title: undefined }],
      ['short title', { title: 'ab' }],
      ['missing abstract', { abstract: undefined }],
      ['short specification', { specification: 'too short' }],
      ['malformed documentKey', { documentKey: 'not-a-key' }],
    ];

    it.each(cases)('rejects %s', async (_label, override) => {
      const { token } = await setup();
      const documentKey = await uploadDocument(token);
      const body = { ...PATENT_BODY, documentKey, ...override };

      Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);

      const res = await api().post('/api/patents').set(authHeader(token)).send(body);

      expect(res.status).toBe(400);
    });
  });
});

describe('Idempotency-Key on POST /api/patents', () => {
  it('returns the original response instead of creating a second patent', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token);
    const body = { ...PATENT_BODY, documentKey };

    const first = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'abc-123')
      .send(body);

    const second = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'abc-123')
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(await prisma.patent.count()).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token);

    await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'abc-123')
      .send({ ...PATENT_BODY, documentKey });

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'abc-123')
      .send({ ...PATENT_BODY, documentKey, title: 'A completely different invention' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/different request body/);
  });
});

describe('patent visibility', () => {
  it('hides another user`s draft', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await createUser({ email: 'nosy@example.com' });
    const nosy = await login('nosy@example.com');

    const res = await api().get(`/api/patents/${draft.id}`).set(authHeader(nosy.accessToken));

    // 404 rather than 403: a 403 would confirm the id exists.
    expect(res.status).toBe(404);
  });

  it('shows an approved patent to any authenticated user', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await createUser({ email: 'reader@example.com' });
    const reader = await login('reader@example.com');

    const res = await api().get(`/api/patents/${patent.id}`).set(authHeader(reader.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('lets an admin see any draft', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api().get(`/api/patents/${draft.id}`).set(authHeader(adminToken));

    expect(res.status).toBe(200);
  });

  it('scopes the list to own plus approved for a non-admin', async () => {
    const { token, adminToken } = await setup();
    await createDraftPatent(token);

    await createUser({ email: 'other@example.com' });
    const other = await login('other@example.com');
    await createDraftPatent(other.accessToken);
    await approvedPatent(other.accessToken, adminToken);

    const res = await api().get('/api/patents').set(authHeader(token));

    expect(res.status).toBe(200);
    // Own draft + the other user's approved patent, but not their draft.
    expect(res.body.data.patents).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  it('lets an admin list everything', async () => {
    const { token, adminToken } = await setup();
    await createDraftPatent(token);
    await createUser({ email: 'other@example.com' });
    const other = await login('other@example.com');
    await createDraftPatent(other.accessToken);

    const res = await api().get('/api/patents').set(authHeader(adminToken));

    expect(res.body.data.patents).toHaveLength(2);
  });

  it('filters by status and category', async () => {
    const { token, adminToken } = await setup();
    const category = await createCategory('Robotics');
    await createDraftPatent(token, { categoryIds: [String(category.id)] });
    await approvedPatent(token, adminToken);

    const byStatus = await api().get('/api/patents?status=approved').set(authHeader(token));
    const byCategory = await api()
      .get(`/api/patents?categoryId=${category.id}`)
      .set(authHeader(token));

    expect(byStatus.body.data.patents).toHaveLength(1);
    expect(byStatus.body.data.patents[0].status).toBe('approved');
    expect(byCategory.body.data.patents).toHaveLength(1);
  });

  it('omits the specification from list responses', async () => {
    const { token } = await setup();
    await createDraftPatent(token);

    const res = await api().get('/api/patents').set(authHeader(token));

    expect(res.body.data.patents[0].specification).toBeUndefined();
    expect(res.body.data.patents[0].abstract).toBeDefined();
  });
});

describe('PATCH /api/patents/:id', () => {
  it('bumps the version when content changes', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ title: 'A markedly improved self-cooling container' });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
  });

  it('does not bump the version for a metadata-only change', async () => {
    const { token } = await setup();
    const category = await createCategory('Materials');
    const draft = await createDraftPatent(token);

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ categoryIds: [String(category.id)] });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.categories).toHaveLength(1);
  });

  it('does not bump the version when the title is resubmitted unchanged', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ title: draft.title });

    expect(res.body.data.version).toBe(1);
  });

  it('refuses to edit a patent under review', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ title: 'Sneaking in a change mid-review' });

    expect(res.status).toBe(409);
  });

  it("refuses to edit another user's patent", async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await createUser({ email: 'other@example.com' });
    const other = await login('other@example.com');

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(other.accessToken))
      .send({ title: 'Hijacking someone else`s draft' });

    expect(res.status).toBe(403);
  });

  it('rejects an empty body', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api().patch(`/api/patents/${draft.id}`).set(authHeader(token)).send({});

    expect(res.status).toBe(400);
  });
});

describe('patent lifecycle', () => {
  it('walks draft -> pending_admin -> approved', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);

    const submitted = await api()
      .post(`/api/patents/${draft.id}/submit`)
      .set(authHeader(token))
      .send();
    expect(submitted.body.data.status).toBe('pending_admin');
    expect(submitted.body.data.submittedAt).toBeTruthy();

    const approved = await api()
      .post(`/api/patents/${draft.id}/approve`)
      .set(authHeader(adminToken))
      .send({ comments: 'Looks novel' });
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.reviewedAt).toBeTruthy();
  });

  it('refuses to approve a patent that was never submitted', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api()
      .post(`/api/patents/${draft.id}/approve`)
      .set(authHeader(adminToken))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/status "draft"/);
  });

  it('refuses to submit twice', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    const res = await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    expect(res.status).toBe(409);
  });

  it('lets a declined patent be edited and resubmitted', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();
    await api()
      .post(`/api/patents/${draft.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Prior art exists in US7654321' });

    const edited = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ abstract: 'A substantially revised abstract addressing the cited prior art here.' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);

    const resubmitted = await api()
      .post(`/api/patents/${draft.id}/submit`)
      .set(authHeader(token))
      .send();
    expect(resubmitted.body.data.status).toBe('pending_admin');
  });

  it('requires comments when declining', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    const res = await api()
      .post(`/api/patents/${draft.id}/decline`)
      .set(authHeader(adminToken))
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects a regular user approving', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    const res = await api().post(`/api/patents/${draft.id}/approve`).set(authHeader(token)).send({});

    expect(res.status).toBe(403);
  });

  it('records a review row for each decision', async () => {
    const { token, adminToken, admin } = await setup();
    const patent = await approvedPatent(token, adminToken);

    const res = await api().get(`/api/patents/${patent.id}/reviews`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reviews).toHaveLength(1);
    expect(res.body.data.reviews[0].decision).toBe('pass');
    expect(res.body.data.reviews[0].stage).toBe('admin_review');
    expect(res.body.data.reviews[0].reviewer.id).toBe(String(admin.id));
  });
});

describe('DELETE /api/patents/:id', () => {
  it('deletes a draft and its stored object', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    const record = await prisma.patent.findUnique({ where: { id: BigInt(draft.id) } });

    const res = await api().delete(`/api/patents/${draft.id}`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(await prisma.patent.count()).toBe(0);
    expect(fakeStorage.objects.has(record.documentKey)).toBe(false);
  });

  it('refuses to delete anything past draft', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    const res = await api().delete(`/api/patents/${patent.id}`).set(authHeader(token));

    expect(res.status).toBe(409);
    expect(await prisma.patent.count()).toBe(1);
  });
});

describe('GET /api/patents/:id/document', () => {
  it('returns a presigned download URL to someone who can see the patent', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api().get(`/api/patents/${draft.id}/document`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.downloadUrl).toContain('fake-storage.test/get');
  });

  it("refuses a document on someone else's draft", async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await createUser({ email: 'nosy@example.com' });
    const nosy = await login('nosy@example.com');

    const res = await api()
      .get(`/api/patents/${draft.id}/document`)
      .set(authHeader(nosy.accessToken));

    expect(res.status).toBe(404);
  });
});
