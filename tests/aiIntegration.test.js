const {
  api,
  prisma,
  createUser,
  createAdmin,
  login,
  authHeader,
  createDraftPatent,
  approvedPatent,
} = require('./helpers');
const aiReportService = require('../src/services/aiReportService');
const { handleMessage } = require('../src/workers/reportConsumer');

/**
 * The boundary with the AI service (`AI_module/`).
 *
 * Both halves are covered here because they are one contract: the backend
 * publishes `Patents.*` events in the shape the AI service's pydantic DTOs
 * parse, and consumes the similarity report it publishes back. A change on
 * either side that these tests do not catch is a change that breaks another
 * team's service silently.
 */

const setup = async () => {
  await createUser({ email: 'inventor@example.com' });
  await createAdmin();

  return {
    token: (await login('inventor@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

const aiEvents = () =>
  prisma.outboxEvent.findMany({ where: { NOT: { topic: null } }, orderBy: { id: 'asc' } });

const submit = (id, token) => api().post(`/api/patents/${id}/submit`).set(authHeader(token)).send();

describe('events published to the AI service', () => {
  it('emits a submitted event when a patent enters review', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await submit(draft.id, token);

    const [event] = await aiEvents();

    expect(event.eventType).toBe('PatentSubmitted');
    expect(event.topic).toBe('Patents.submitted');
  });

  /**
   * The AI's DTO requires every one of these fields and rejects the message
   * outright if one is missing, so the shape is the contract.
   */
  it('matches the payload shape the AI service parses', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await submit(draft.id, token);

    const [{ payload }] = await aiEvents();

    expect(Object.keys(payload).sort()).toEqual([
      'abstract',
      'applicationNumber',
      'eventId',
      'fileUrl',
      'patentId',
      'submittedAt',
      'submittedBy',
      'title',
    ]);
    // patentId and submittedBy are `int` on their side, not strings — unlike
    // the domain contract, which stringifies BigInt ids.
    expect(typeof payload.patentId).toBe('number');
    expect(typeof payload.submittedBy).toBe('number');
    expect(payload.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /**
   * A presigned URL would expire while the event sat in the outbox or on the
   * topic, leaving events that can never be processed. A URI names the object
   * for as long as the object exists.
   */
  it('carries an s3 URI rather than a presigned URL', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await submit(draft.id, token);

    const [{ payload }] = await aiEvents();

    expect(payload.fileUrl).toMatch(/^s3:\/\/[^/]+\/patents\//);
    expect(payload.fileUrl).not.toMatch(/X-Amz-Signature|\?/);
  });

  /**
   * The abstract is what the search feature explains matches with.
   *
   * On approval it lands in the Qdrant payload, LangChain is configured to read
   * that key as the document's page_content, and the explanation prompt is told
   * to ground every match in it. Drop the field and search still finds the right
   * patents while every explanation degrades to "no abstract was available".
   * Cheap to assert, and the failure it prevents is invisible from our side.
   */
  it('carries the abstract the explanation chain grounds matches in', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await submit(draft.id, token);

    const [{ payload }] = await aiEvents();

    expect(payload.abstract).toBe(draft.abstract);
    expect(typeof payload.abstract).toBe('string');
  });

  /** Required by their DTO, nullable here, and read by nothing on their side. */
  it('substitutes a placeholder when there is no publication number', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    await submit(draft.id, token);

    const [{ payload }] = await aiEvents();

    expect(payload.applicationNumber).toBe(`PENDING-${draft.id}`);
  });

  it('emits an approved event on approval', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    const events = await aiEvents();

    expect(events.map((e) => [e.eventType, e.topic])).toEqual([
      ['PatentSubmitted', 'Patents.submitted'],
      ['PatentApproved', 'Patents.approved'],
    ]);
  });

  /**
   * Broader than the domain contract's withdrawal, which only fires for
   * approved → declined because only an approved patent was ever in the search
   * corpus. The AI service cached an embedding at submission time, so a patent
   * declined without ever being approved still has state to clean up there.
   */
  it('emits a rejected event even when the patent was never approved', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await submit(draft.id, token);

    await api()
      .post(`/api/patents/${draft.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Insufficient detail in the specification' });

    const events = await aiEvents();

    expect(events.map((e) => e.eventType)).toEqual(['PatentSubmitted', 'PatentRejected']);
    // The domain contract stays silent: nothing was ever in the corpus.
    expect(await prisma.outboxEvent.count({ where: { topic: null } })).toBe(0);
  });

  it('emits both a withdrawal and a rejection when an approved patent is declined', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await api()
      .post(`/api/patents/${patent.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Withdrawn after a third-party objection' });

    const all = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });

    expect(all.map((e) => e.eventType)).toEqual([
      'PatentSubmitted',
      'PatentVersionUpserted',
      'PatentApproved',
      'PatentVersionWithdrawn',
      'PatentRejected',
    ]);
  });

  /**
   * The whole point of the outbox: the event and the state change share a
   * transaction, so a submission that fails to record its event does not
   * happen at all.
   */
  it('rolls the submission back if its AI event cannot be written', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    const outboxService = require('../src/services/outboxService');

    const spy = jest
      .spyOn(outboxService, 'enqueue')
      .mockRejectedValueOnce(new Error('outbox write failed'));

    const res = await submit(draft.id, token);
    spy.mockRestore();

    expect(res.status).toBe(500);

    const patent = await prisma.patent.findUnique({ where: { id: BigInt(draft.id) } });
    expect(patent.status).toBe('draft');
    expect(patent.submittedAt).toBeNull();
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});

describe('similarity reports consumed from the AI service', () => {
  const report = (patentId, matches) => ({
    patent_id: Number(patentId),
    title: 'A self-cooling beverage container',
    matches,
  });

  const message = (value) => ({ message: { value: Buffer.from(JSON.stringify(value), 'utf8') } });

  const reviewsFor = (patentId) =>
    prisma.patentReview.findMany({ where: { patentId: BigInt(patentId), reviewStage: 'ai_filter' } });

  it('records a report as an ai_filter review row', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await handleMessage(
      message(report(patent.id, [{ patent_id: 999, title: 'A prior cooling vessel', score: 0.9123 }])),
    );

    const [review] = await reviewsFor(patent.id);

    expect(review.reviewStage).toBe('ai_filter');
    // Advisory only: the AI does not reach a verdict, and it is not a person.
    expect(review.decision).toBeNull();
    expect(review.reviewerId).toBeNull();
    expect(Number(review.aiConfidenceScore)).toBeCloseTo(91.23, 2);
    expect(JSON.parse(review.comments).matches).toEqual([
      { patentId: '999', title: 'A prior cooling vessel', score: 0.9123 },
    ]);
  });

  /**
   * Delivery is at-least-once in both directions, so a redelivered report must
   * not pile up duplicate rows for an admin to disambiguate.
   */
  it('is idempotent: a redelivered report updates rather than duplicates', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);
    const payload = message(report(patent.id, [{ patent_id: 999, title: 'Prior art', score: 0.5 }]));

    const first = await handleMessage(payload);
    const second = await handleMessage(payload);

    expect(first.status).toBe('created');
    expect(second.status).toBe('updated');
    expect(await reviewsFor(patent.id)).toHaveLength(1);
  });

  it('replaces a stale report with a newer one for the same patent', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await handleMessage(message(report(patent.id, [{ patent_id: 1, title: 'Old', score: 0.2 }])));
    await handleMessage(message(report(patent.id, [{ patent_id: 2, title: 'New', score: 0.8 }])));

    const [review] = await reviewsFor(patent.id);

    expect(Number(review.aiConfidenceScore)).toBeCloseTo(80, 2);
    expect(JSON.parse(review.comments).matches[0].title).toBe('New');
  });

  it('sorts matches by descending score and drops a self-match', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await handleMessage(
      message(
        report(patent.id, [
          { patent_id: Number(patent.id), title: 'Itself', score: 1 },
          { patent_id: 5, title: 'Weak', score: 0.1 },
          { patent_id: 6, title: 'Strong', score: 0.7 },
        ]),
      ),
    );

    const [review] = await reviewsFor(patent.id);
    const { matches } = JSON.parse(review.comments);

    expect(matches.map((m) => m.title)).toEqual(['Strong', 'Weak']);
    expect(Number(review.aiConfidenceScore)).toBeCloseTo(70, 2);
  });

  it('records a report with no matches at all', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await handleMessage(message(report(patent.id, [])));

    const [review] = await reviewsFor(patent.id);

    expect(review.aiConfidenceScore).toBeNull();
    expect(JSON.parse(review.comments).matchCount).toBe(0);
  });

  /**
   * A bad payload from another team's service will still be bad on every
   * retry. Acknowledging it keeps one malformed report from blocking every
   * later report on the partition — the opposite of the relay's deliberate
   * head-of-line blocking, because there the payload is ours.
   */
  const discarded = [
    ['a patent that no longer exists', { patent_id: 999999, title: 'Gone', matches: [] }],
    ['a missing patent id', { title: 'No id', matches: [] }],
    ['a non-numeric patent id', { patent_id: 'abc', title: 'Bad id', matches: [] }],
    ['a null body', null],
  ];

  it.each(discarded)('discards %s instead of retrying forever', async (_label, payload) => {
    await setup();

    const result = await handleMessage(message(payload));

    expect(result.status).toBe('ignored');
    expect(await prisma.patentReview.count()).toBe(0);
  });

  it('discards a message that is not valid JSON', async () => {
    const result = await handleMessage({ message: { value: Buffer.from('not json', 'utf8') } });

    expect(result).toEqual({ status: 'ignored', reason: 'invalid json' });
  });

  it('discards an empty message', async () => {
    const result = await handleMessage({ message: { value: null } });

    expect(result).toEqual({ status: 'ignored', reason: 'empty message' });
  });

  /**
   * A database failure is ours and is transient, so it must propagate: an
   * uncommitted offset is what gets the message redelivered.
   */
  it('rethrows a database failure so the offset is not committed', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    const spy = jest
      .spyOn(aiReportService, 'recordSimilarityReport')
      .mockRejectedValueOnce(new Error('connection reset'));

    await expect(handleMessage(message(report(patent.id, [])))).rejects.toThrow('connection reset');

    spy.mockRestore();
  });

  /**
   * The report is surfaced through the existing endpoint rather than a new
   * one, which is what made the reserved `ai_filter` stage worth using.
   */
  it('surfaces the report through GET /patents/:id/reviews', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await handleMessage(
      message(report(patent.id, [{ patent_id: 999, title: 'Prior art', score: 0.88 }])),
    );

    const res = await api().get(`/api/patents/${patent.id}/reviews`).set(authHeader(token));

    expect(res.status).toBe(200);
    const ai = res.body.data.reviews.find((r) => r.stage === 'ai_filter');
    expect(ai).toBeTruthy();
    expect(ai.aiConfidenceScore).toBeCloseTo(88, 2);
    // No reviewer: the AI is not a person, and the DTO must not invent one.
    expect(ai.reviewer).toBeNull();
    expect(JSON.parse(ai.comments).source).toBe('ai-similarity');
  });
});
