const config = require('./env');

/**
 * The HTTP client for the AI service's search API, behind a setter — the same
 * shape as `config/storage.js` and `config/kafka.js`, and for the same reason.
 *
 * Without it, testing semantic search would mean standing up the AI container:
 * an 8.7 GB image that downloads an embedding model and calls Gemini. A suite
 * that needs that is a suite nobody runs, so `tests/fakes.js` substitutes an
 * in-memory stand-in and no test ever leaves the process.
 *
 * This is the *only* synchronous dependency the backend has on the AI service.
 * Everything else between the two systems flows through Kafka, which is what
 * keeps a dead AI service from affecting the patent lifecycle at all. Search is
 * the exception because a query has to be answered while the caller waits — so
 * it is also the one place that has to degrade gracefully on its own.
 */

const SEARCH_PATH = '/api/v1/patents/search';

/** How much of an error body to keep. Enough to name the cause, not a novel. */
const ERROR_BODY_CHARS = 500;

const buildClient = () => ({
  /**
   * False when `AI_SEARCH_URL` is unset. Checked before every call so a
   * deployment that has not stood the AI service up yet reports the feature as
   * unavailable rather than dialling an empty host.
   */
  isConfigured: () => Boolean(config.ai.searchUrl),

  /**
   * POSTs the query text and returns the parsed body.
   *
   * Throws on anything that is not a 2xx with JSON — transport failure,
   * timeout, or an error status. The caller turns every one of those into the
   * same 503, but the message is preserved for the log, because "responded 500:
   * ... GOOGLE_API_KEY" and "connect ECONNREFUSED" send an operator to two very
   * different places.
   */
  async search(text) {
    // FastAPI holds the connection open for the whole LLM round trip, so an AI
    // service that is up but wedged would otherwise pin this request until the
    // client gave up.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ai.searchTimeoutMs);

    try {
      const response = await fetch(`${config.ai.searchUrl}${SEARCH_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');

        throw new Error(
          `AI search responded ${response.status}: ${body.slice(0, ERROR_BODY_CHARS)}`,
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  },
});

let client = null;

const getSearchClient = () => {
  if (!client) client = buildClient();
  return client;
};

const setSearchClient = (replacement) => {
  client = replacement;
};

module.exports = { SEARCH_PATH, getSearchClient, setSearchClient };
