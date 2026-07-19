import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton';
import './Stat.css';

export interface StatProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  tone?: 'brand' | 'accent' | 'success' | 'neutral';
}

/** A compact metric tile for dashboard summaries. */
export function Stat({ label, value, icon, hint, loading = false, tone = 'neutral' }: StatProps) {
  return (
    <div className={`stat stat--${tone}`}>
      {icon && <span className="stat__icon">{icon}</span>}
      <div className="stat__content">
        <span className="stat__label">{label}</span>
        {loading ? (
          <Skeleton width={64} height={26} />
        ) : (
          <span className="stat__value">{value}</span>
        )}
        {hint && <span className="stat__hint">{hint}</span>}
      </div>
    </div>
  );
}
