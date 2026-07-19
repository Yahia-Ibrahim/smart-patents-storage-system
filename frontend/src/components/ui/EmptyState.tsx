import type { ReactNode } from 'react';
import { InboxIcon } from '@/components/icons';
import './States.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`state ${compact ? 'state--compact' : ''}`}>
      <div className="state__icon state__icon--muted">{icon ?? <InboxIcon size={26} />}</div>
      <p className="state__title">{title}</p>
      {description && <p className="state__desc">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}
