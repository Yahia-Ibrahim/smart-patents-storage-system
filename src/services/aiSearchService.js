const prisma = require('../config/prisma');
const { getSearchClient } = require('../config/aiSearch');
const { serviceUnavailable } = require('../utils/errors');
const access = require('./patents/access');

/**
 * Semantic prior-art search, proxied to the AI service.
 *
 * The AI service answers with patent ids and prose; this module decides what
 * the caller is allowed to see and what the patents actually are right now.
 * Two reasons that resolution is not optional:
 *
 *  1. **Visibility.** The AI's corpus is not access-controlled. Only approved
 *     patents are ever inserted into it, so in the steady state every match is
 *     public — but a patent declined a moment ago still has its vector in
 *     Qdrant until the `Patents.rejected` event is processed, and a deleted one
 *     may never lose it. Handing those ids straight back would leak titles the
 *     caller has no right to. Every id is re-read through the same
 *     `visibilityWhere` every other patent read uses, and anything that does
 *     not come back is dropped.
 *
 *  2. **Freshness.** The title in the vector payload is a copy taken at
 *     approval. Re-reading gives the caller the live record — current status,
 *     categories, submitter — which is what the UI needs to render a result as
 *     a real patent rather than a name and a paragraph.
 */

/** Matches are dropped, not errored on, when they cannot be parsed. */
const toPatentId = (value) => {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) return null;

  return BigInt(id);
};

/**
 * Normalises the AI service's response.
 *
 * Written defensively because the shape is another team's to change: anything
 * unrecognisable degrades to "no matches" rather than throwing, since a search
 * that returns nothing is a far better outcome than a 500 on a page.
 */
const parseResponse = (raw) => {
  if (!raw || typeof raw !== 'object') return { summary: '', matches: [] };

  const results = Array.isArray(raw.results) ? raw.results : [];

  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    matches: results
      .map((result) => ({
        patentId: toPatentId(result?.patent_id),
        explanation:
          typeof result?.why_they_overlap === 'string' && result.why_they_overlap.trim()
            ? result.why_they_overlap.trim()
            : null,
      }))
      .filter((match) => match.patentId !== null),
  };
};

/**
 * Re-reads every matched patent through the caller's visibility rules.
 *
 * One query rather than one per match, then reordered in memory: the AI ranked
 * these by relevance and `findMany` would return them in id order, which would
 * silently reverse the ranking on a result set the user reads top-down.
 */
const resolveMatches = async (matches, user) => {
  if (matches.length === 0) return [];

  const patents = await prisma.patent.findMany({
    where: {
      AND: [{ id: { in: matches.map((match) => match.patentId) } }, access.visibilityWhere(user)],
    },
    include: access.PATENT_INCLUDE,
  });

  const byId = new Map(patents.map((patent) => [patent.id, patent]));

  return matches
    .map((match) => ({ patent: byId.get(match.patentId), explanation: match.explanation }))
    .filter((match) => match.patent !== undefined);
};

/**
 * Runs a search.
 *
 * Every failure of the AI service becomes one 503 with one message. The caller
 * cannot act on the difference between "no API key", "Qdrant is empty" and
 * "the container is restarting" — all three mean *try again later, and tell an
 * operator* — and spelling them out to an unauthenticated-adjacent caller would
 * describe our internals. The distinction is kept in the log, where it is
 * useful.
 */
const search = async (text, user) => {
  const client = getSearchClient();

  if (!client.isConfigured()) {
    throw serviceUnavailable('Semantic search is not enabled on this server');
  }

  let raw;

  try {
    raw = await client.search(text);
  } catch (error) {
    console.warn(`[ai-search] search failed: ${error.message}`);

    throw serviceUnavailable('Semantic search is temporarily unavailable. Please try again.');
  }

  const { summary, matches } = parseResponse(raw);

  return { summary, matches: await resolveMatches(matches, user) };
};

module.exports = { parseResponse, resolveMatches, search };
