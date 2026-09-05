import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
} from '@/components/ui';
import type { Column } from '@/components/ui';
import { CheckCircleIcon, ChevronRightIcon, SparkIcon } from '@/components/icons';
import { useAsync } from '@/hooks/useAsync';
import { patentService } from '@/services/patentService';
import type { Patent } from '@/types';
import { patentRef, relativeTime, similarityTone } from '@/utils/format';
import './Patents.css';

const PAGE_SIZE = 10;

/**
 * The examiner's queue: everything waiting on an admin decision.
 *
 * It exists as its own page rather than a filter on the patents list because it
 * is a different job. The list answers "what is in the registry"; this answers
 * "what is waiting for me", and it is ranked by the one number that helps
 * triage — the AI's top prior-art similarity.
 *
 * That score is advisory and gates nothing. It is shown because a reviewer
 * deciding which of thirty filings to open first is exactly the decision it can
 * help with, and hidden nowhere else it would be useful.
 */
export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, loading, error, refetch } = useAsync(
    (signal) => patentService.list({ page, limit: PAGE_SIZE, status: 'pending_admin' }, signal),
    [page],
  );

  const columns = useMemo<Column<Patent>[]>(
    () => [
      {
        key: 'patent',
        header: 'Filing',
        render: (patent) => (
          <div className="patents__cell-main">
            <span className="patents__cell-title">{patent.title}</span>
            <span className="patents__cell-sub">
              <span className="ref">{patentRef(patent.id)}</span>
              <span className="patents__dot" aria-hidden="true" />
              <span>{patent.submitter?.name ?? 'Unknown submitter'}</span>
            </span>
          </div>
        ),
      },
      {
        key: 'ai',
        header: (
          <span className="queue__ai-header">
            <SparkIcon size={14} /> Prior art
          </span>
        ),
        width: '180px',
        render: (patent) => <AiCell patent={patent} />,
      },
      {
        key: 'waiting',
        header: 'Waiting',
        hideOnMobile: true,
        render: (patent) => (
          <span className="patents__muted">
            {patent.submittedAt ? relativeTime(patent.submittedAt) : '—'}
          </span>
        ),
      },
      {
        key: 'go',
        header: '',
        align: 'right',
        width: '48px',
        render: () => <ChevronRightIcon size={18} className="patents__chevron" />,
      },
    ],
    [],
  );

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <>
      <PageHeader
        eyebrow="Examination"
        title="Review queue"
        description="Filings awaiting a decision, with the AI's prior-art assessment for triage. The assessment is advisory — it decides nothing."
        actions={
          total > 0 ? (
            <Badge tone="brand" variant="stamp">
              {total} awaiting
            </Badge>
          ) : undefined
        }
      />

      {error ? (
        <Card padding="none">
          <ErrorState message={error.message} onRetry={refetch} />
        </Card>
      ) : (
        <>
          <Card padding="none">
            <DataTable
              columns={columns}
              rows={data?.patents ?? []}
              rowKey={(patent) => patent.id}
              loading={loading}
              caption="Filings awaiting review"
              onRowClick={(patent) => navigate(`/patents/${patent.id}`)}
              empty={
                <EmptyState
                  icon={<CheckCircleIcon size={26} />}
                  title="Nothing waiting"
                  description="Every submitted filing has been decided. New submissions appear here immediately."
                />
              }
            />
          </Card>

          {totalPages > 1 && (
            <div className="patents__pagination">
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                summary={`${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Three genuinely different states, and conflating them would mislead a
 * reviewer: no report yet (the AI is behind, or was down), a report with no
 * matches (a real finding — nothing resembles this), and a score.
 */
function AiCell({ patent }: { patent: Patent }) {
  const summary = patent.aiSimilarity;

  if (!summary) {
    return <span className="patents__muted queue__pending">Awaiting analysis</span>;
  }

  if (summary.score === null) {
    return (
      <Badge tone="success" variant="soft">
        No matches
      </Badge>
    );
  }

  // The DTO carries a percentage; similarityTone reads a 0..1 score.
  const tone = similarityTone(summary.score / 100);

  return (
    <span className="queue__score">
      <span className="queue__meter">
        <span
          className={`queue__meter-fill is-${tone}`}
          style={{ width: `${Math.max(2, Math.min(100, summary.score))}%` }}
        />
      </span>
      <span className={`queue__score-value is-${tone}`}>{summary.score.toFixed(1)}%</span>
    </span>
  );
}
