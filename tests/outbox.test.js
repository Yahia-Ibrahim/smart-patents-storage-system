const {
  api,
  prisma,
  createUser,
  createAdmin,
  login,
  authHeader,
  createDraftPatent,
  approvedPatent,
  createCategory,
  createInventor,
} = require('./helpers');
const { fakeProducer } = require('./fakes');
const { publishBatch, MAX_PAYLOAD_BYTES } = require('../src/workers/outboxRelay');
const outboxService = require('../src/services/outboxService');

const setup = async () => {
  await createUser({ email: 'inventor@example.com' });
  await createAdmin();

  return {
    token: (await login('inventor@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

const submit = (id, token) => api().post(`/api/patents/${id}/submit`).set(authHeader(token)).send();

describe('outbox writes', () => {
  it('enqueues exactly one event when a patent is approved', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    const events = await prisma.outboxEvent.findMany();

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('PatentVersionUpserted');
    expect(events[0].aggregateType).toBe('patent');
    expect(String(events[0].aggregateId)).toBe(patent.id);
    expect(events[0].publishedAt).toBeNull();
  });

  it('writes nothing on create, submit, or edit', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);
    await api()
      .patch(`/api/patents/${draft.id}`)
      .set(authHeader(token))
      .send({ title: 'An amended title for the cooling container' });
    await submit(draft.id, token);

    // Only approval makes a patent corpus-visible, so only approval emits.
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('carries the full document in the payload so a consumer needs no callback', async () => {
    const { token, adminToken } = await setup();
    const category = await createCategory('Thermodynamics');
    const inventor = await createInventor({ fullName: 'Nikola Tesla', email: 'nikola@example.com' });

    const patent = await approvedPatent(token, adminToken, {
      publicationNumber: 'US9876543',
      jurisdiction: 'US',
      categoryIds: [String(category.id)],
      inventors: [{ inventorId: String(inventor.id), order: 1 }],
    });

    const [event] = await prisma.outboxEvent.findMany();
    const payload = event.payload;

    expect(payload.patent_id).toBe(patent.id);
    expect(payload.version).toBe(1);
    expect(payload.title).toBeTruthy();
    expect(payload.abstract).toBeTruthy();
    expect(payload.specification).toBeTruthy();
    expect(payload.publication_number).toBe('US9876543');
    expect(payload.jurisdiction).toBe('US');
    expect(payload.categories).toEqual(['Thermodynamics']);
    expect(payload.inventors).toEqual([
      { id: String(inventor.id), full_name: 'Nikola Tesla', organization: expect.anything(), order: 1 },
    ]);
    expect(payload.document_key).toBeTruthy();
    expect(payload.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.occurred_at).toBeTruthy();
  });

  it('enqueues a withdrawal when an approved patent is later declined', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await api()
      .post(`/api/patents/${patent.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Withdrawn after a third-party objection' });

    const events = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });

    expect(events.map((e) => e.eventType)).toEqual([
      'PatentVersionUpserted',
      'PatentVersionWithdrawn',
    ]);
    expect(events[1].payload.reason).toBe('declined');
  });

  it('does not enqueue a withdrawal for a patent that was never approved', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await submit(draft.id, token);

    await api()
      .post(`/api/patents/${draft.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Insufficient detail in the specification' });

    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  /**
   * The core guarantee: the event row and the state change share a
   * transaction, so a failure in either leaves neither. Simulated by making
   * the review insert fail on a comment longer than the column allows.
   */
  it('rolls back the status change if the event cannot be written', async () => {
    const { token, adminToken } = await setup();
    const draft = await createDraftPatent(token);
    await submit(draft.id, token);

    const spy = jest
      .spyOn(outboxService, 'enqueue')
      .mockRejectedValueOnce(new Error('outbox write failed'));

    const res = await api()
      .post(`/api/patents/${draft.id}/approve`)
      .set(authHeader(adminToken))
      .send({});

    spy.mockRestore();

    expect(res.status).toBe(500);

    const patent = await prisma.patent.findUnique({ where: { id: BigInt(draft.id) } });
    expect(patent.status).toBe('pending_admin');
    expect(await prisma.patentReview.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});

describe('outbox relay', () => {
  it('publishes pending events and marks them published', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    const result = await publishBatch();

    expect(result).toEqual({ claimed: 1, published: 1 });
    expect(fakeProducer.messages).toHaveLength(1);
    expect(fakeProducer.messages[0].topic).toBe('patents.events');
    expect(fakeProducer.messages[0].value.patent_id).toBe(patent.id);
    expect(fakeProducer.messages[0].headers['event-type']).toBe('PatentVersionUpserted');

    const [event] = await prisma.outboxEvent.findMany();
    expect(event.publishedAt).not.toBeNull();
  });

  /**
   * Kafka only orders within a partition, so every version of one patent has
   * to land on the same one. Keying by patent id is what guarantees that.
   */
  it('keys messages by patent id so versions stay ordered', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await publishBatch();

    expect(fakeProducer.messages[0].key).toBe(patent.id);
  });

  it('publishes nothing when the outbox is empty', async () => {
    await setup();

    const result = await publishBatch();

    expect(result).toEqual({ claimed: 0, published: 0 });
    expect(fakeProducer.messages).toHaveLength(0);
  });

  it('is idempotent across passes: a published event is never re-sent', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    await publishBatch();
    await publishBatch();

    expect(fakeProducer.messages).toHaveLength(1);
  });

  it('leaves a row unpublished and records the failure when the broker rejects it', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    fakeProducer.failNext = 1;

    const result = await publishBatch();

    expect(result.published).toBe(0);

    const [event] = await prisma.outboxEvent.findMany();
    expect(event.publishedAt).toBeNull();
    expect(event.attempts).toBe(1);
    expect(event.lastError).toMatch(/simulated broker failure/);
    // The claim is released, so the next pass retries immediately rather than
    // waiting out the claim timeout.
    expect(event.claimedAt).toBeNull();
  });

  it('retries a previously failed event on the next pass', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    fakeProducer.failNext = 1;
    await publishBatch();
    const afterFailure = await publishBatch();

    expect(afterFailure.published).toBe(1);
    expect(fakeProducer.messages).toHaveLength(1);
  });

  /**
   * Head-of-line blocking is deliberate. Skipping a failed event would deliver
   * v2 of a patent before v1, and per-patent ordering matters more than
   * throughput at this scale.
   */
  it('stops the batch at the first failure rather than skipping ahead', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);
    await approvedPatent(token, adminToken, { publicationNumber: 'US2222222' });

    expect(await prisma.outboxEvent.count()).toBe(2);

    fakeProducer.failNext = 1;
    const result = await publishBatch();

    expect(result.published).toBe(0);
    expect(fakeProducer.messages).toHaveLength(0);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(2);
  });

  it('publishes events in id order', async () => {
    const { token, adminToken } = await setup();
    const first = await approvedPatent(token, adminToken);
    const second = await approvedPatent(token, adminToken, { publicationNumber: 'US3333333' });

    await publishBatch();

    expect(fakeProducer.messages.map((m) => m.key)).toEqual([first.id, second.id]);
  });
});

describe('outbox stats', () => {
  it('reports the pending backlog', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    expect(await outboxService.stats()).toEqual({ pending: 1, retrying: 0, deadLettered: 0 });

    await publishBatch();

    expect(await outboxService.stats()).toEqual({ pending: 0, retrying: 0, deadLettered: 0 });
  });
});

/**
 * Regression coverage for the failure modes an external review found. Each of
 * these passed before the fix only because nothing exercised the path.
 */
describe('outbox relay: failure modes', () => {
  /**
   * Publishing used to happen inside a Prisma interactive transaction. A
   * mid-batch failure rolled back the markPublished writes of events that had
   * already reached Kafka, so the next pass re-sent them — an unbounded
   * duplicate loop rather than at-least-once redelivery. Failing the *second*
   * event is what exercises that; failing the first never did.
   */
  it('keeps earlier successes when a later event in the batch fails', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);
    await approvedPatent(token, adminToken, { publicationNumber: 'US4444444' });
    await approvedPatent(token, adminToken, { publicationNumber: 'US5555555' });

    // Let the first through, fail the second.
    const realSend = fakeProducer.send.bind(fakeProducer);
    let calls = 0;
    fakeProducer.send = async (payload) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated broker failure');
      return realSend(payload);
    };

    const result = await publishBatch();
    fakeProducer.send = realSend;

    expect(result.published).toBe(1);

    const events = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    // First stays published; it must never be re-sent.
    expect(events[0].publishedAt).not.toBeNull();
    expect(events[1].publishedAt).toBeNull();
    expect(events[1].attempts).toBe(1);
    // Third was claimed but never attempted; its claim is released on the next
    // pass via the claim timeout, and it has burned no attempts.
    expect(events[2].publishedAt).toBeNull();
    expect(events[2].attempts).toBe(0);

    // The already-published event is not re-sent on a later pass.
    fakeProducer.reset();
    await publishBatch();
    const keys = fakeProducer.messages.map((m) => m.value.patent_id);
    expect(keys).not.toContain(String(events[0].aggregateId));
  });

  /**
   * Head-of-line blocking is deliberate, but without a cap a permanently
   * poisonous event blocks every later event forever. After OUTBOX_MAX_ATTEMPTS
   * the row is dead-lettered so the queue drains past it.
   */
  it('dead-letters an event that keeps failing, so the queue can drain', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);
    await approvedPatent(token, adminToken, { publicationNumber: 'US6666666' });

    const [poison] = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    await prisma.outboxEvent.update({
      where: { id: poison.id },
      data: { attempts: 10, lastError: 'permanently rejected' },
    });

    const result = await publishBatch();

    // The blocked event is skipped entirely and the one behind it goes out.
    expect(result.published).toBe(1);
    expect(fakeProducer.messages).toHaveLength(1);

    const stats = await outboxService.stats();
    expect(stats.deadLettered).toBe(1);
    expect(stats.pending).toBe(1);
  });

  /**
   * An oversized payload can never be published, so retrying it would wedge the
   * queue for OUTBOX_MAX_ATTEMPTS passes. It fails immediately with a clear
   * reason instead of hitting the broker.
   */
  it('rejects an oversized payload without calling the broker', async () => {
    const { token, adminToken } = await setup();
    await approvedPatent(token, adminToken);

    const [event] = await prisma.outboxEvent.findMany();
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { payload: { ...event.payload, specification: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) } },
    });

    const result = await publishBatch();

    expect(result.published).toBe(0);
    expect(fakeProducer.messages).toHaveLength(0);
    const [after] = await prisma.outboxEvent.findMany();
    expect(after.lastError).toMatch(/over the .* limit/);
  });

  /**
   * (patent_id, version) is not a safe dedup key on its own: approve -> decline
   * -> re-approve repeats the same version, and a consumer deduping on it would
   * discard the re-approval and drop the patent from the corpus permanently.
   * `sequence` is monotonic and distinguishes them.
   */
  it('stamps a monotonic sequence that distinguishes a re-approval from a redelivery', async () => {
    const { token, adminToken } = await setup();
    const patent = await approvedPatent(token, adminToken);

    await api()
      .post(`/api/patents/${patent.id}/decline`)
      .set(authHeader(adminToken))
      .send({ comments: 'Withdrawn pending further review of the cited art' });
    await submit(patent.id, token);
    await api().post(`/api/patents/${patent.id}/approve`).set(authHeader(adminToken)).send({});

    await publishBatch();

    const upserts = fakeProducer.messages.filter(
      (m) => m.value.event_type === 'PatentVersionUpserted',
    );

    expect(upserts).toHaveLength(2);
    // Same content version - which is exactly why version alone cannot dedup.
    expect(upserts[0].value.version).toBe(upserts[1].value.version);
    expect(BigInt(upserts[1].value.sequence)).toBeGreaterThan(BigInt(upserts[0].value.sequence));

    const sequences = fakeProducer.messages.map((m) => BigInt(m.value.sequence));
    expect(sequences).toEqual([...sequences].sort((a, b) => (a < b ? -1 : 1)));
  });
});
