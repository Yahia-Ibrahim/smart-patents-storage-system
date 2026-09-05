import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@/components/ui';
import { SparkIcon } from '@/components/icons';
import type { PatentReview } from '@/types';
import { formatDateTime, patentRef, similarityPercent, similarityTone } from '@/utils/format';
import { parseAiReport } from '@/utils/aiReport';

/**
 * The AI service's prior-art report for one patent.
 *
 * It arrives asynchronously over Kafka after submission, so its absence is the
 * normal state for the first few seconds of a filing's life and for every
 * filing made while the AI service was down. That is the reason for the "not
 * yet" copy rather than an error: nothing is wrong, and nothing is blocked —
 * the AI gates no part of the lifecycle.
 *
 * Every patent it can name is already approved, because only approved patents
 * are inserted into the vector corpus. That is what makes it safe to show this
 * to the submitter and not only to reviewing admins.
 */
export function AiReportCard({ review }: { review: PatentReview | null }) {
  const report = review ? parseAiReport(review) : null;

  return (
    <Card className="ai-report">
      <div className="ai-report__head">
        <span className="ai-report__mark" aria-hidden="true">
          <SparkIcon size={18} />
        </span>
        <div className="ai-report__heading">
          <h3 className="ai-report__title">Prior-art similarity</h3>
          <p className="ai-report__sub">
            Advisory only — generated automatically on submission. It does not affect the review
            decision.
          </p>
        </div>
        {review && report && report.matches.length > 0 && (
          <Badge tone={similarityTone(report.matches[0].score)} variant="stamp">
            {similarityPercent(report.matches[0].score)} top match
          </Badge>
        )}
      </div>

      {!review ? (
        <EmptyState
          compact
          title="No analysis yet"
          description="The report is produced after a filing is submitted for review. If it was submitted recently, it should appear shortly."
        />
      ) : !report ? (
        <EmptyState
          compact
          title="Report could not be read"
          description="An analysis was recorded but its contents were not in the expected format."
        />
      ) : report.matches.length === 0 ? (
        <EmptyState
          compact
          title="No similar patents found"
          description="Nothing in the approved corpus resembled this filing closely enough to flag."
        />
      ) : (
        <ol className="ai-report__list">
          {report.matches.map((match) => (
            <li key={match.patentId} className="ai-report__item">
              <div className="ai-report__item-main">
                {/* Linked, because the whole point is to go and read it. The
                    target is approved and therefore visible to anyone here. */}
                <Link to={`/patents/${match.patentId}`} className="ai-report__item-title">
                  {match.title || 'Untitled patent'}
                </Link>
                <span className="ref ai-report__item-ref">{patentRef(match.patentId)}</span>
              </div>
              <div className="ai-report__meter" title={`Cosine similarity ${match.score.toFixed(4)}`}>
                <div className="ai-report__meter-track">
                  <div
                    className={`ai-report__meter-fill is-${similarityTone(match.score)}`}
                    style={{ width: `${Math.max(2, Math.min(100, match.score * 100))}%` }}
                  />
                </div>
                <span className="ai-report__score">{similarityPercent(match.score)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {review && (
        <p className="ai-report__foot">Analysed {formatDateTime(review.createdAt)}</p>
      )}
    </Card>
  );
}
