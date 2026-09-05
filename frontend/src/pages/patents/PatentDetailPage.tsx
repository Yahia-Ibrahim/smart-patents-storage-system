import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Modal,
  Skeleton,
  SkeletonText,
  StatusBadge,
  Tabs,
} from '@/components/ui';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  DownloadIcon,
  EditIcon,
  SendIcon,
  TrashIcon,
  XCircleIcon,
} from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { ApiClientError } from '@/services/apiClient';
import { isEditable, patentService } from '@/services/patentService';
import type { PatentReview } from '@/types';
import { formatDateTime, patentRef } from '@/utils/format';
import { AiReportCard } from './components/AiReportCard';
import { ReviewTimeline } from './components/ReviewTimeline';
import { DecisionModal } from './components/DecisionModal';
import type { Decision } from './components/DecisionModal';
import './Patents.css';

type Tab = 'document' | 'review';

export function PatentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAdmin } = useAuth();

  const [tab, setTab] = useState<Tab>('document');
  const [busy, setBusy] = useState<'submit' | 'delete' | 'download' | 'decision' | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patent = useAsync((signal) => patentService.get(id, signal), [id]);
  const record = patent.data;

  const isOwner = Boolean(record && user && record.submittedBy === user.id);
  // GET /patents/:id/reviews is owner-or-admin, not "anyone who can see the
  // patent": review comments are internal notes and name the reviewing admin.
  // Asking as anyone else earns a 403, so we do not ask.
  const canSeeReviews = isOwner || isAdmin;

  const reviews = useAsync(
    (signal) =>
      canSeeReviews ? patentService.reviews(id, signal) : Promise.resolve({ reviews: [] }),
    [id, canSeeReviews],
  );

  const aiReview = useMemo<PatentReview | null>(
    () => reviews.data?.reviews.find((review) => review.stage === 'ai_filter') ?? null,
    [reviews.data],
  );

  const refreshAll = () => {
    patent.refetch();
    reviews.refetch();
  };

  const failed = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiClientError ? error.message : fallback);

  const onSubmit = async () => {
    setBusy('submit');
    try {
      await patentService.submit(id);
      toast.success('Submitted for review', {
        description: 'An examiner will review it. Similarity analysis runs automatically.',
      });
      refreshAll();
    } catch (error) {
      failed(error, 'Could not submit this filing.');
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setBusy('delete');
    try {
      await patentService.remove(id);
      toast.success('Filing deleted');
      navigate('/patents', { replace: true });
    } catch (error) {
      failed(error, 'Could not delete this filing.');
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  /**
   * The download URL is presigned and short-lived, so it is fetched at the
   * moment of the click rather than rendered into an href on load — a link
   * minted when the page opened would be dead by the time a reader got to it.
   */
  const onDownload = async () => {
    setBusy('download');
    try {
      const link = await patentService.documentLink(id);
      window.open(link.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      failed(error, 'Could not open the document.');
    } finally {
      setBusy(null);
    }
  };

  const onDecide = async (comments: string) => {
    if (!decision) return;

    setBusy('decision');
    setDecisionError(null);
    try {
      if (decision === 'approve') await patentService.approve(id, comments);
      else await patentService.decline(id, comments);

      toast.success(decision === 'approve' ? 'Filing approved' : 'Filing declined');
      setDecision(null);
      refreshAll();
    } catch (error) {
      setDecisionError(
        error instanceof ApiClientError ? error.message : 'Could not record that decision.',
      );
    } finally {
      setBusy(null);
    }
  };

  if (patent.error) {
    return (
      <>
        <BackLink />
        <Card padding="none">
          <ErrorState
            title={patent.error.status === 404 ? 'Filing not found' : 'Could not load this filing'}
            message={
              patent.error.status === 404
                ? 'It may have been deleted, or it may not be visible to your account.'
                : patent.error.message
            }
            onRetry={patent.error.status === 404 ? undefined : patent.refetch}
          />
        </Card>
      </>
    );
  }

  if (patent.loading || !record) {
    return (
      <>
        <BackLink />
        <Card>
          <Skeleton width="60%" height={28} />
          <div className="patent__skeleton">
            <SkeletonText lines={4} />
          </div>
        </Card>
      </>
    );
  }

  const editable = isEditable(record) && isOwner;
  const decidable = isAdmin && record.status === 'pending_admin';

  return (
    <>
      <BackLink />

      <div className="patent__header">
        <div className="patent__identity">
          <div className="patent__badges">
            <StatusBadge status={record.status} />
            <span className="ref">{patentRef(record.id)}</span>
            {record.publicationNumber && (
              <span className="ref patent__pubnum">{record.publicationNumber}</span>
            )}
            <Badge tone="neutral">v{record.version}</Badge>
          </div>
          <h1 className="patent__title">{record.title}</h1>
          <p className="patent__byline">
            {record.submitter ? `Filed by ${record.submitter.name}` : 'Filed'}
            {record.jurisdiction ? ` · ${record.jurisdiction}` : ''} ·{' '}
            {formatDateTime(record.createdAt)}
          </p>
        </div>

        <div className="patent__actions">
          {record.hasDocument && (
            <Button
              variant="secondary"
              leftIcon={<DownloadIcon size={18} />}
              loading={busy === 'download'}
              onClick={onDownload}
            >
              Document
            </Button>
          )}
          {editable && (
            <>
              <Button
                variant="secondary"
                leftIcon={<EditIcon size={18} />}
                onClick={() => navigate(`/patents/${record.id}/edit`)}
              >
                Edit
              </Button>
              <Button
                leftIcon={<SendIcon size={18} />}
                loading={busy === 'submit'}
                onClick={onSubmit}
              >
                Submit for review
              </Button>
            </>
          )}
          {decidable && (
            <>
              <Button
                variant="danger"
                leftIcon={<XCircleIcon size={18} />}
                onClick={() => setDecision('decline')}
              >
                Decline
              </Button>
              <Button
                leftIcon={<CheckCircleIcon size={18} />}
                onClick={() => setDecision('approve')}
              >
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      {record.status === 'declined' && isOwner && (
        <Alert tone="warning" title="This filing was declined">
          Read the examiner’s reasoning under Examination, make your changes, and submit it again —
          a declined filing can be edited and resubmitted.
        </Alert>
      )}

      {record.status === 'draft' && isOwner && (
        <Alert tone="info" title="This is still a draft">
          Only you can see it. Submitting sends it to an examiner and triggers automatic prior-art
          analysis.
        </Alert>
      )}

      <div className="patent__layout">
        <div className="patent__main">
          <Tabs
            tabs={[
              { id: 'document', label: 'Filing' },
              {
                id: 'review',
                label: canSeeReviews ? 'Examination' : 'Examination (restricted)',
              },
            ]}
            active={tab}
            onChange={(next) => setTab(next as Tab)}
          />

          {tab === 'document' ? (
            <>
              <Card>
                <CardHeader title="Abstract" />
                <p className="patent__prose">{record.abstract}</p>
              </Card>

              <Card>
                <CardHeader title="Specification" />
                {/* Preserved whitespace: a specification is written in
                    paragraphs and numbered clauses, and collapsing them makes
                    it unreadable. */}
                <p className="patent__prose patent__prose--pre">{record.specification}</p>
              </Card>
            </>
          ) : canSeeReviews ? (
            <>
              <AiReportCard review={aiReview} />
              <Card>
                <CardHeader
                  title="Examination trail"
                  description="Every decision recorded against this filing."
                />
                {reviews.error ? (
                  <ErrorState compact message={reviews.error.message} onRetry={reviews.refetch} />
                ) : reviews.loading ? (
                  <SkeletonText lines={3} />
                ) : (
                  <ReviewTimeline reviews={reviews.data?.reviews ?? []} />
                )}
              </Card>
            </>
          ) : (
            <Card>
              <Alert tone="info" title="Examination notes are private">
                Review comments and similarity analysis are visible to the filing’s owner and to
                administrators only.
              </Alert>
            </Card>
          )}
        </div>

        <aside className="patent__side">
          <Card>
            <CardHeader title="Details" />
            <dl className="patent__facts">
              <Fact label="Status" value={<StatusBadge status={record.status} />} />
              <Fact label="Version" value={`v${record.version}`} />
              <Fact
                label="Jurisdiction"
                value={record.jurisdiction ?? <span className="patents__muted">Not set</span>}
              />
              <Fact
                label="Publication no."
                value={
                  record.publicationNumber ? (
                    <span className="ref">{record.publicationNumber}</span>
                  ) : (
                    <span className="patents__muted">Not assigned</span>
                  )
                }
              />
              <Fact
                label="Submitted"
                value={
                  record.submittedAt ? (
                    formatDateTime(record.submittedAt)
                  ) : (
                    <span className="patents__muted">Not yet</span>
                  )
                }
              />
              <Fact
                label="Reviewed"
                value={
                  record.reviewedAt ? (
                    formatDateTime(record.reviewedAt)
                  ) : (
                    <span className="patents__muted">Not yet</span>
                  )
                }
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Inventors" />
            {record.inventors.length === 0 ? (
              <p className="patents__muted">None named.</p>
            ) : (
              <ol className="patent__inventors">
                {record.inventors.map((inventor) => (
                  <li key={inventor.id} className="patent__inventor">
                    <span className="patent__inventor-order">{inventor.order}</span>
                    <span className="patent__inventor-body">
                      <span className="patent__inventor-name">{inventor.fullName}</span>
                      {inventor.organization && (
                        <span className="patents__muted">{inventor.organization}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="Categories" />
            {record.categories.length === 0 ? (
              <p className="patents__muted">Uncategorised.</p>
            ) : (
              <div className="patents__tags">
                {record.categories.map((category) => (
                  <span key={category.id} className="patents__tag">
                    {category.name}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {editable && (
            <Card>
              <CardHeader title="Danger zone" />
              <p className="patents__muted patent__danger-copy">
                Deleting a draft also removes its uploaded document. This cannot be undone.
              </p>
              <Button
                variant="danger"
                leftIcon={<TrashIcon size={18} />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete filing
              </Button>
            </Card>
          )}
        </aside>
      </div>

      <DecisionModal
        decision={decision}
        patentTitle={record.title}
        submitting={busy === 'decision'}
        error={decisionError}
        onCancel={() => {
          setDecision(null);
          setDecisionError(null);
        }}
        onConfirm={onDecide}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this filing?"
        description={record.title}
        dismissible={busy !== 'delete'}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={busy === 'delete'}
            >
              Keep it
            </Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={onDelete}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p>
          The filing and its uploaded document are removed. Nothing about it is recoverable
          afterwards.
        </p>
      </Modal>
    </>
  );
}

function BackLink() {
  return (
    <Link to="/patents" className="detail__back">
      <ArrowLeftIcon size={18} />
      All patents
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="patent__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
