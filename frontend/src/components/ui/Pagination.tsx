import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import './Pagination.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Optional summary like "Showing 1–20 of 128". */
  summary?: string;
}

// Page numbers to show, with -1 marking an ellipsis gap.
function pageWindow(page: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: number[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(-1);
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({ page, totalPages, onChange, summary }: PaginationProps) {
  if (totalPages <= 1 && !summary) return null;
  const items = pageWindow(page, totalPages);

  return (
    <div className="pagination">
      {summary && <p className="pagination__summary">{summary}</p>}
      {totalPages > 1 && (
        <nav className="pagination__controls" aria-label="Pagination">
          <button
            type="button"
            className="pagination__btn"
            onClick={() => onChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeftIcon size={16} />
          </button>
          {items.map((p, i) =>
            p === -1 ? (
              <span key={`gap-${i}`} className="pagination__gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`pagination__btn ${p === page ? 'is-active' : ''}`}
                onClick={() => onChange(p)}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className="pagination__btn"
            onClick={() => onChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRightIcon size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
