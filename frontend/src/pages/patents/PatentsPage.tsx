import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
} from '@/components/ui';
import type { Column } from '@/components/ui';
import { ChevronRightIcon, FileIcon, PlusIcon, SearchIcon, SparkIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { patentService } from '@/services/patentService';
import { catalogService } from '@/services/catalogService';
import type { Patent, PatentStatus } from '@/types';
import { formatDate, patentRef } from '@/utils/format';
import './Patents.css';

const PAGE_SIZE = 10;

/**
 * `pending_ai` is deliberately absent: it is reserved in the schema and nothing
 * ever moves a patent into it, so offering it would be a filter that always
 * returns nothing.
 */
const STATUS_OPTIONS: { value: PatentStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_admin', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];

export function PatentsPage() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | PatentStatus>('');
  const [categoryId, setCategoryId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const debouncedSearch = useDebounced(search, 350);

  const categories = useAsync((signal) => catalogService.listCategories(undefined, signal), []);

  const { data, loading, error, refetch } = useAsync(
    (signal) =>
      patentService.list(
        {
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch.trim() || undefined,
          status: status || undefined,
          categoryId: categoryId || undefined,
          submittedBy: mineOnly ? user?.id : undefined,
        },
        signal,
      ),
    [page, debouncedSearch, status, categoryId, mineOnly, user?.id],
  );

  // Any filter change re-slices the result set, so page 4 of the old one is
  // meaningless — and often empty, which reads as "no results".
  const onFilterChange = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns = useMemo<Column<Patent>[]>(
    () => [
      {
        key: 'patent',
        header: 'Patent',
        render: (patent) => (
          <div className="patents__cell-main">
            <span className="patents__cell-title">{patent.title}</span>
            <span className="patents__cell-sub">
              <span className="ref">{patentRef(patent.id)}</span>
              {patent.publicationNumber && (
                <>
                  <span className="patents__dot" aria-hidden="true" />
                  <span className="ref">{patent.publicationNumber}</span>
                </>
              )}
            </span>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (patent) => <StatusBadge status={patent.status} />,
      },
      {
        key: 'categories',
        header: 'Categories',
        hideOnMobile: true,
        render: (patent) =>
          patent.categories.length === 0 ? (
            <span className="patents__muted">—</span>
          ) : (
            <span className="patents__tags">
              {patent.categories.slice(0, 2).map((category) => (
                <span key={category.id} className="patents__tag">
                  {category.name}
                </span>
              ))}
              {patent.categories.length > 2 && (
                <span className="patents__muted">+{patent.categories.length - 2}</span>
              )}
            </span>
          ),
      },
      // Who filed it is only shown to admins: for everyone else the list is
      // their own patents plus approved ones, where the column is either
      // themselves or noise.
      ...(isAdmin
        ? [
            {
              key: 'submitter',
              header: 'Submitted by',
              hideOnMobile: true,
              render: (patent: Patent) => (
                <span className="patents__muted">{patent.submitter?.name ?? '—'}</span>
              ),
            } as Column<Patent>,
          ]
        : []),
      {
        key: 'updated',
        header: 'Updated',
        hideOnMobile: true,
        render: (patent) => <span className="patents__muted">{formatDate(patent.updatedAt)}</span>,
      },
      {
        key: 'go',
        header: '',
        align: 'right',
        width: '48px',
        render: () => <ChevronRightIcon size={18} className="patents__chevron" />,
      },
    ],
    [isAdmin],
  );

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const hasFilters = Boolean(debouncedSearch.trim() || status || categoryId || mineOnly);

  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Patents"
        description={
          isAdmin
            ? 'Every filing in the registry, in any state.'
            : 'Your filings, plus every patent that has been approved.'
        }
        actions={
          <div className="patents__header-actions">
            <Button
              variant="secondary"
              leftIcon={<SparkIcon size={18} />}
              onClick={() => navigate('/patents/search')}
            >
              Prior-art search
            </Button>
            <Button leftIcon={<PlusIcon size={18} />} onClick={() => navigate('/patents/new')}>
              New filing
            </Button>
          </div>
        }
      />

      <Card padding="sm" className="patents__toolbar">
        <div className="patents__search">
          <Input
            type="search"
            placeholder="Search titles, abstracts and publication numbers…"
            leftIcon={<SearchIcon size={18} />}
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            aria-label="Search patents"
          />
        </div>
        <div className="patents__filter">
          <Select
            value={status}
            onChange={(e) => onFilterChange(() => setStatus(e.target.value as '' | PatentStatus))}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="patents__filter">
          <Select
            value={categoryId}
            onChange={(e) => onFilterChange(() => setCategoryId(e.target.value))}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {(categories.data?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="patents__toggle">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => onFilterChange(() => setMineOnly(e.target.checked))}
          />
          <span>Only mine</span>
        </label>
      </Card>

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
              caption="Patents"
              onRowClick={(patent) => navigate(`/patents/${patent.id}`)}
              empty={
                <EmptyState
                  icon={<FileIcon size={26} />}
                  title={hasFilters ? 'No patents match those filters' : 'No patents yet'}
                  description={
                    hasFilters
                      ? 'Try a broader search, or clear the status and category filters.'
                      : 'Start a filing and it will appear here as a draft until you submit it for review.'
                  }
                  action={
                    hasFilters ? undefined : (
                      <Button
                        leftIcon={<PlusIcon size={18} />}
                        onClick={() => navigate('/patents/new')}
                      >
                        New filing
                      </Button>
                    )
                  }
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
                summary={`${rangeStart}–${rangeEnd} of ${total}`}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
