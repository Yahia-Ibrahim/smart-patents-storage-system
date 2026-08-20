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
const { publishBatch } = require('../src/workers/outboxRelay');
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

    expect(await outboxService.stats()).toEqual({ pending: 1, stuck: 0 });

    await publishBatch();

    expect(await outboxService.stats()).toEqual({ pending: 0, stuck: 0 });
  });
});
