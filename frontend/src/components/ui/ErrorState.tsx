import type { ReactNode } from 'react';
import { AlertTriangleIcon, RefreshIcon } from '@/components/icons';
import { Button } from './Button';
import './States.css';

export interface ErrorStateProps {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We couldn’t load this content. Please try again.',
  onRetry,
  retryLabel = 'Try again',
  compact = false,
}: ErrorStateProps) {
  return (
    <div className={`state ${compact ? 'state--compact' : ''}`} role="alert">
      <div className="state__icon state__icon--danger">
        <AlertTriangleIcon size={26} />
      </div>
      <p className="state__title">{title}</p>
      {message && <p className="state__desc">{message}</p>}
      {onRetry && (
        <div className="state__action">
          <Button variant="secondary" size="sm" onClick={onRetry} leftIcon={<RefreshIcon size={16} />}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
