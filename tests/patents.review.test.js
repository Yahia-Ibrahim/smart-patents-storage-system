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
  PATENT_BODY,
} = require('./helpers');
const { fakeStorage } = require('./fakes');

/**
 * Regression coverage for findings from an external code review.
 *
 * Every test here corresponds to a real defect that shipped. They are grouped
 * separately from patents.test.js so the reason they exist stays obvious: each
 * one pins a path that nothing exercised, which is precisely why the bug
 * survived to be found by reading rather than by running.
 */

const setup = async () => {
  const user = await createUser({ email: 'inventor@example.com' });
  const admin = await createAdmin();

  return {
    user,
    admin,
    token: (await login('inventor@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

describe('document ownership', () => {
  /**
   * A document could be attached to two patents. Deleting the draft then
   * destroyed the object the approved patent still pointed at — the exact
   * tampering the draft-only delete rule exists to prevent.
   */
  it('refuses to attach one document to two patents', async () => {
    const { token, adminToken } = await setup();
    const approved = await approvedPatent(token, adminToken);
    const record = await prisma.patent.findUnique({ where: { id: BigInt(approved.id) } });

    const res = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .send({ ...PATENT_BODY, documentKey: record.documentKey });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already attached/);
    expect(fakeStorage.objects.has(record.documentKey)).toBe(true);
  });

  it('deletes the superseded object when a document is replaced', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    const before = await prisma.patent.findUnique({ where: { id: BigInt(draft.id) } });
    const replacement = await uploadDocument(token, { filename: 'revised.pdf' });

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ documentKey: replacement });

    expect(res.status).toBe(200);
    expect(fakeStorage.objects.has(before.documentKey)).toBe(false);
    expect(fakeStorage.objects.has(replacement)).toBe(true);
  });

  /**
   * An admin uploads under their own id, so verifying the key against the
   * submitter's namespace rejected every admin document replacement.
   */
  it("lets an admin replace the document on another user's patent", async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    const adminKey = await uploadDocument(adminToken, { filename: 'corrected.pdf' });

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(adminToken))
      .send({ documentKey: adminKey });

    expect(res.status).toBe(200);
    expect(res.body.data.documentKey).toBe(adminKey);
  });
});

describe('visibility and personal data', () => {
  /** The deliberate half of the visibility rule, previously unpinned. */
  it("lets any authenticated user fetch an approved patent's document", async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);
    await createUser({ email: 'reader@example.com' });
    const reader = await login('reader@example.com');

    const res = await api()
      .get(`/api/patents/${patent.id}/document`)
      .set(authHeader(reader.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.downloadUrl).toBeTruthy();
  });

  /**
   * Review comments are internal examiner notes and each row names the
   * reviewing admin. Gating on visibility alone published both to every
   * signed-up user the moment a patent was approved.
   */
  it('hides review history from users who are not the submitter', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);
    await createUser({ email: 'nosy@example.com' });
    const nosy = await login('nosy@example.com');

    const stranger = await api()
      .get(`/api/patents/${patent.id}/reviews`)
      .set(authHeader(nosy.accessToken));
    const owner = await api().get(`/api/patents/${patent.id}/reviews`).set(authHeader(token));

    expect(stranger.status).toBe(403);
    expect(owner.status).toBe(200);
  });

  it("hides the submitter's email from other users but shows it to an admin", async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);
    await createUser({ email: 'reader@example.com' });
    const reader = await login('reader@example.com');

    const asStranger = await api()
      .get(`/api/patents/${patent.id}`)
      .set(authHeader(reader.accessToken));
    const asAdmin = await api().get(`/api/patents/${patent.id}`).set(authHeader(adminToken));
    const asOwner = await api().get(`/api/patents/${patent.id}`).set(authHeader(token));

    expect(asStranger.body.data.submitter.email).toBeUndefined();
    expect(asStranger.body.data.submitter.name).toBeTruthy();
    expect(asAdmin.body.data.submitter.email).toBe('inventor@example.com');
    expect(asOwner.body.data.submitter.email).toBe('inventor@example.com');
  });
});

describe('validation gaps that produced 500s', () => {
  /**
   * `optional({ values: 'falsy' })` let 0, false and '' skip the entire
   * validation chain and reach Prisma, which raised a 500 for what is plainly
   * a bad request.
   */
  it('rejects a non-string jurisdiction with 400, not 500', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ jurisdiction: 0 });

    expect(res.status).toBe(400);
  });

  it('rejects an empty publicationNumber rather than storing it', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    const res = await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ publicationNumber: '' });

    expect(res.status).toBe(400);
    const stored = await prisma.patent.findUnique({ where: { id: BigInt(draft.id) } });
    expect(stored.publicationNumber).toBeNull();
  });

  /** An id past int8 used to reach the driver and surface as a 500. */
  it('rejects an out-of-range id with 400, not 500', async () => {
    const { token } = await setup();

    const res = await api()
      .get(`/api/patents/${'9'.repeat(26)}`)
      .set(authHeader(token));

    expect(res.status).toBe(400);
  });
});

describe('concurrency', () => {
  /**
   * Status was read before the transaction and written unconditionally, so two
   * concurrent approvals both passed the check and both committed — two review
   * rows and two identical events.
   */
  it('lets only one of two concurrent approvals win', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await api().post(`/api/patents/${draft.id}/submit`).set(authHeader(token)).send();

    const results = await Promise.all([
      api().post(`/api/patents/${draft.id}/approve`).set(authHeader(adminToken)).send({}),
      api().post(`/api/patents/${draft.id}/approve`).set(authHeader(adminToken)).send({}),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.patentReview.count()).toBe(1);
    // One approval's worth of events, not two: the domain upsert plus the AI
    // event, on top of the submit event from earlier in the test.
    expect(await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } })).toEqual([
      expect.objectContaining({ eventType: 'PatentSubmitted' }),
      expect.objectContaining({ eventType: 'PatentVersionUpserted' }),
      expect.objectContaining({ eventType: 'PatentApproved' }),
    ]);
  });

  /**
   * The concurrent retry is the case Idempotency-Key exists for, and a
   * look-then-insert did not cover it: both requests found no row and both
   * created a patent.
   */
  it('does not create two patents when the same key is retried concurrently', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token);
    const body = { ...PATENT_BODY, documentKey };

    const send = () =>
      api()
        .post('/api/patents')
        .set(authHeader(token))
        .set('Idempotency-Key', 'concurrent-1')
        .send(body);

    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r) => r.status).sort();

    // One creates it; the other is told the original is in flight, or gets the
    // replayed response. Either way there is exactly one patent.
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    expect(await prisma.patent.count()).toBe(1);
  });

  it('releases the idempotency key when the request fails, so a retry can succeed', async () => {
    const { token } = await setup();
    const documentKey = await uploadDocument(token);

    const bad = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'retry-after-failure')
      .send({ ...PATENT_BODY, documentKey, title: 'x' });

    expect(bad.status).toBe(400);

    const good = await api()
      .post('/api/patents')
      .set(authHeader(token))
      .set('Idempotency-Key', 'retry-after-failure')
      .send({ ...PATENT_BODY, documentKey });

    expect(good.status).toBe(201);
  });
});
