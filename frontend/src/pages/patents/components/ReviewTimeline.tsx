import { Badge, EmptyState } from '@/components/ui';
import { CheckCircleIcon, XCircleIcon } from '@/components/icons';
import type { PatentReview } from '@/types';
import { formatDateTime } from '@/utils/format';

/**
 * The human examination trail.
 *
 * `ai_filter` rows are filtered out here on purpose: they are the AI's
 * similarity report, which has its own card, and they carry JSON rather than
 * prose. Rendering them alongside human decisions would put a machine's output
 * in a list of people's judgements.
 */
export function ReviewTimeline({ reviews }: { reviews: PatentReview[] }) {
  const decisions = reviews.filter((review) => review.stage === 'admin_review');

  if (decisions.length === 0) {
    return (
      <EmptyState
        compact
        title="No decisions yet"
        description="Once an examiner approves or declines this filing, their decision and reasoning appear here."
      />
    );
  }

  return (
    <ol className="review-trail">
      {decisions.map((review) => {
        const passed = review.decision === 'pass';

        return (
          <li key={review.id} className="review-trail__item">
            <span
              className={`review-trail__mark is-${passed ? 'pass' : 'fail'}`}
              aria-hidden="true"
            >
              {passed ? <CheckCircleIcon size={18} /> : <XCircleIcon size={18} />}
            </span>

            <div className="review-trail__body">
              <div className="review-trail__head">
                <Badge tone={passed ? 'success' : 'danger'} variant="stamp">
                  {passed ? 'Approved' : 'Declined'}
                </Badge>
                <span className="review-trail__meta">
                  {/* The reviewer can be absent if their account was removed;
                      the decision itself still stands and still matters. */}
                  {review.reviewer?.name ?? 'An examiner'} · {formatDateTime(review.createdAt)}
                </span>
              </div>
              {review.comments && <p className="review-trail__comment">{review.comments}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
