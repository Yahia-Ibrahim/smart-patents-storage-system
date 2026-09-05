const {
  api,
  createUser,
  createAdmin,
  login,
  authHeader,
  createDraftPatent,
  approvedPatent,
} = require('./helpers');
const { fakeAiSearch } = require('./fakes');

/**
 * `POST /patents/search` — the one synchronous call the backend makes to the AI
 * service.
 *
 * Everything else between the two systems is Kafka, which is what keeps a dead
 * AI service off the patent lifecycle entirely. Search cannot work that way: a
 * query has to be answered while the caller waits. So this endpoint is the only
 * place where the AI's availability is visible to a user, and the only place
 * where its output needs re-checking against our own access rules before it
 * reaches one.
 *
 * The AI service itself is faked (`tests/fakes.js`). What is under test here is
 * not its search quality — that is theirs — but what this API does with what it
 * returns.
 */

const setup = async () => {
  await createUser({ email: 'inventor@example.com' });
  await createUser({ name: 'Other', email: 'other@example.com' });
  await createAdmin();

  return {
    token: (await login('inventor@example.com')).accessToken,
    otherToken: (await login('other@example.com')).accessToken,
    adminToken: (await login('admin@example.com')).accessToken,
  };
};

const search = (token, text = 'a container that chills a drink without power') =>
  api().post('/api/patents/search').set(authHeader(token)).send({ text });

/** The shape the AI service's FastAPI route actually returns. */
const aiResult = (patentId, why = 'Both describe endothermic cooling.') => ({
  patent_id: Number(patentId),
  title: 'whatever the corpus remembers',
  why_they_overlap: why,
});

describe('POST /patents/search', () => {
  it('requires authentication', async () => {
    const res = await api().post('/api/patents/search').send({ text: 'cooling' });

    expect(res.status).toBe(401);
  });

  it('rejects text below the minimum length', async () => {
    const { token } = await setup();

    const res = await api().post('/api/patents/search').set(authHeader(token)).send({ text: 'ab' });

    expect(res.status).toBe(400);
    expect(fakeAiSearch.calls).toHaveLength(0);
  });

  it('passes the query through to the AI service', async () => {
    const { token } = await setup();

    await search(token, 'a beverage container that chills itself');

    expect(fakeAiSearch.calls).toEqual(['a beverage container that chills itself']);
  });

  it('returns the summary and the live patent behind each match', async () => {
    const { token, adminToken } = await setup();
    const approved = await approvedPatent(token, adminToken);

    fakeAiSearch.respondWith({
      summary: 'One closely related filing.',
      results: [aiResult(approved.id)],
    });

    const res = await search(token);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBe('One closely related filing.');
    expect(res.body.data.results).toHaveLength(1);

    const [match] = res.body.data.results;

    expect(match.explanation).toBe('Both describe endothermic cooling.');
    // The patent comes from our database, not from the AI's payload: the title
    // in the vector store is a copy taken at approval time.
    expect(match.patent.id).toBe(approved.id);
    expect(match.patent.title).toBe(approved.title);
    expect(match.patent.status).toBe('approved');
  });

  /**
   * The corpus is not access-controlled, and it lags: a patent declined a
   * moment ago still has its vector in Qdrant until `Patents.rejected` is
   * processed, and a deleted one may never lose it. Returning ids the AI
   * offered without re-reading them would leak titles through the one endpoint
   * that never touches `findVisiblePatent`.
   */
  it('drops matches the caller is not allowed to see', async () => {
    const { token, otherToken } = await setup();
    const draft = await createDraftPatent(token);

    fakeAiSearch.respondWith({ summary: 'A match.', results: [aiResult(draft.id)] });

    const res = await search(otherToken);

    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
  });

  it('still shows a submitter their own unapproved patent', async () => {
    const { token } = await setup();
    const draft = await createDraftPatent(token);

    fakeAiSearch.respondWith({ results: [aiResult(draft.id)] });

    const res = await search(token);

    expect(res.body.data.results.map((match) => match.patent.id)).toEqual([draft.id]);
  });

  it('drops matches for patents that no longer exist', async () => {
    const { token } = await setup();

    fakeAiSearch.respondWith({ results: [aiResult(999999)] });

    const res = await search(token);

    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
  });

  /**
   * `findMany` returns rows in whatever order the database likes, and the AI's
   * ranking is the entire value of the endpoint. Re-reading the patents must
   * not quietly reorder them.
   */
  it('preserves the ranking the AI service returned', async () => {
    const { token, adminToken } = await setup();
    const first = await approvedPatent(token, adminToken);
    const second = await approvedPatent(token, adminToken);
    const third = await approvedPatent(token, adminToken);

    fakeAiSearch.respondWith({
      results: [aiResult(third.id), aiResult(first.id), aiResult(second.id)],
    });

    const res = await search(token);

    expect(res.body.data.results.map((match) => match.patent.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it('tolerates a match with no explanation', async () => {
    const { token, adminToken } = await setup();
    const approved = await approvedPatent(token, adminToken);

    fakeAiSearch.respondWith({
      results: [{ patent_id: Number(approved.id), title: 'x', why_they_overlap: '   ' }],
    });

    const res = await search(token);

    expect(res.body.data.results[0].explanation).toBeNull();
  });

  /**
   * The response shape belongs to another team. An unrecognisable body should
   * come back as "nothing found", not as a 500 on the user's screen.
   */
  it.each([
    ['null', null],
    ['a string', 'unexpected'],
    ['an object with no results', { summary: 'hm' }],
    ['results that are not an array', { summary: 'hm', results: 'nope' }],
    ['a match with an unusable id', { results: [{ patent_id: 'abc' }] }],
  ])('degrades to an empty result set when the AI returns %s', async (_label, body) => {
    const { token } = await setup();

    fakeAiSearch.response = body;

    const res = await search(token);

    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
  });

  /**
   * 503, not 500. The request was fine; the dependency is not. That distinction
   * is what lets the frontend say "try again shortly" instead of "something
   * went wrong", and what keeps an AI outage from reading as a backend bug.
   */
  it('reports a 503 when the AI service is unreachable', async () => {
    const { token } = await setup();

    fakeAiSearch.failWith('connect ECONNREFUSED 172.18.0.9:8000');

    const res = await search(token);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  /** The upstream message can name a host, a key, or a stack. None of it ships. */
  it('does not leak the AI service failure to the caller', async () => {
    const { token } = await setup();

    fakeAiSearch.failWith('AI search responded 500: GOOGLE_API_KEY missing at /app/app/ai');

    const res = await search(token);

    expect(res.body.error.message).not.toMatch(/GOOGLE_API_KEY|\/app\//);
  });

  it('reports a 503 when no AI service is configured at all', async () => {
    const { token } = await setup();

    fakeAiSearch.configured = false;

    const res = await search(token);

    expect(res.status).toBe(503);
    expect(fakeAiSearch.calls).toHaveLength(0);
  });

  /**
   * Emails are viewer-scoped everywhere else; a new endpoint returning patent
   * DTOs must not become the one that publishes the directory.
   */
  it('withholds the submitter email from someone else', async () => {
    const { token, otherToken, adminToken } = await setup();
    const approved = await approvedPatent(token, adminToken);

    fakeAiSearch.respondWith({ results: [aiResult(approved.id)] });

    const asStranger = await search(otherToken);
    const asAdmin = await search(adminToken);

    expect(asStranger.body.data.results[0].patent.submitter.email).toBeUndefined();
    expect(asAdmin.body.data.results[0].patent.submitter.email).toBe('inventor@example.com');
  });
});
