const prisma = require('../config/prisma');

/**
 * Persists similarity reports produced by the AI service.
 *
 * The report arrives on `Notifications.similarity-report` as
 * `{ patent_id, title, matches: [{ patent_id, title, score }] }` (see
 * `AI_module/app/models/dto.py: SimilarityReportDTO`) and lands as a
 * `PATENT_REVIEW` row with `reviewStage: ai_filter`.
 *
 * That stage and `aiConfidenceScore` were reserved in the schema and never
 * used; this is what they were reserved for, so the report needs no new table
 * and surfaces through the existing owner-or-admin `GET /patents/:id/reviews`.
 *
 * **Advisory only.** `decision` is deliberately left null: the AI does not gate
 * the lifecycle, and inventing a pass/fail threshold here would turn a hint for
 * the reviewing admin into a verdict nobody asked for.
 */

const REVIEW_STAGE = 'ai_filter';

/**
 * Only *approved* patents are ever inserted into the vector store
 * (`IndexingService.handle_approved_patent`), so a match can only name a patent
 * that is already public. That is what makes it safe to show a report to a
 * submitter rather than admins alone.
 */
const parseReport = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const patentId = Number(raw.patent_id);
  if (!Number.isSafeInteger(patentId) || patentId <= 0) return null;

  const matches = Array.isArray(raw.matches) ? raw.matches : [];

  return {
    patentId: BigInt(patentId),
    title: typeof raw.title === 'string' ? raw.title : '',
    matches: matches
      // A patent can match itself once it is in the corpus; that is noise, not
      // a finding.
      .filter((match) => Number(match?.patent_id) !== patentId)
      .map((match) => ({
        patentId: String(match.patent_id),
        title: typeof match.title === 'string' ? match.title : '',
        score: Number(match.score),
      }))
      .filter((match) => Number.isFinite(match.score))
      .sort((a, b) => b.score - a.score),
  };
};

/**
 * Stored as a percentage, not the raw 0..1 cosine score: the column is
 * `Decimal(5, 2)`, so two decimal places on a percentage keeps a meaningful
 * gradation where two decimal places on 0..1 would round 0.9567 to 0.96.
 */
const topScorePercent = (matches) =>
  matches.length ? Math.round(matches[0].score * 10000) / 100 : null;

/**
 * Writes the report, replacing any previous one for the same patent.
 *
 * Replace rather than append, for two reasons. Delivery is at-least-once, so a
 * redelivered report must not pile up duplicate rows; and a patent that is
 * declined, edited and resubmitted gets a fresh report that supersedes the old
 * one rather than sitting alongside it, where an admin would have to work out
 * which is current.
 *
 * Find-then-write inside a transaction, rather than a unique constraint and an
 * upsert, because the constraint would be a migration on a table that has other
 * (human) review rows per patent. One consumer per partition makes this safe;
 * see the note in workers/reportConsumer.js about the AI service publishing
 * reports without a key.
 */
const recordSimilarityReport = async (raw) => {
  const report = parseReport(raw);

  if (!report) return { status: 'ignored', reason: 'malformed report' };

  // The patent may legitimately be gone — deleted while the report was in
  // flight. Dropping the report is correct; failing would park a poison message
  // that can never succeed.
  const patent = await prisma.patent.findUnique({
    where: { id: report.patentId },
    select: { id: true },
  });

  if (!patent) return { status: 'ignored', reason: 'unknown patent' };

  const comments = JSON.stringify({
    source: 'ai-similarity',
    matchCount: report.matches.length,
    matches: report.matches,
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.patentReview.findFirst({
      where: { patentId: report.patentId, reviewStage: REVIEW_STAGE },
      select: { id: true },
    });

    const data = {
      aiConfidenceScore: topScorePercent(report.matches),
      comments,
    };

    if (existing) {
      await tx.patentReview.update({ where: { id: existing.id }, data });
      return { status: 'updated', patentId: String(report.patentId) };
    }

    await tx.patentReview.create({
      data: {
        patentId: report.patentId,
        reviewerId: null,
        reviewStage: REVIEW_STAGE,
        decision: null,
        ...data,
      },
    });

    return { status: 'created', patentId: String(report.patentId) };
  });
};

module.exports = { REVIEW_STAGE, parseReport, topScorePercent, recordSimilarityReport };
