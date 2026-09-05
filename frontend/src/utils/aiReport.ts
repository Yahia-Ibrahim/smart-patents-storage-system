import type { AiSimilarityMatch, AiSimilarityReport, PatentReview } from '@/types';

/**
 * Reads the AI service's similarity report out of a review row.
 *
 * The report arrives over Kafka and is stored as JSON in `PATENT_REVIEW.comments`
 * rather than in its own table, because `reviewStage: ai_filter` and
 * `aiConfidenceScore` were already reserved in the schema for exactly this. The
 * upside is that it surfaces through the existing owner-or-admin
 * `GET /patents/:id/reviews` with no new endpoint; the cost is this parse.
 *
 * Returns null for anything that is not a well-formed report. A human review's
 * `comments` is plain prose and lands here too whenever a caller maps over every
 * review, so "not JSON" is an ordinary outcome, not an error worth surfacing.
 */
export function parseAiReport(review: Pick<PatentReview, 'stage' | 'comments'>): AiSimilarityReport | null {
  if (review.stage !== 'ai_filter' || !review.comments) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(review.comments);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const body = parsed as { matchCount?: unknown; matches?: unknown };
  const raw = Array.isArray(body.matches) ? body.matches : [];

  const matches: AiSimilarityMatch[] = raw
    .map((entry) => entry as { patentId?: unknown; title?: unknown; score?: unknown })
    .filter((entry) => typeof entry.patentId === 'string' && typeof entry.score === 'number')
    .map((entry) => ({
      patentId: entry.patentId as string,
      title: typeof entry.title === 'string' ? entry.title : 'Untitled',
      score: entry.score as number,
    }));

  return {
    matchCount: typeof body.matchCount === 'number' ? body.matchCount : matches.length,
    matches,
  };
}
