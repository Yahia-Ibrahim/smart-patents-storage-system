import type { ReactNode } from 'react';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
} from '@/components/icons';
import './Alert.css';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ICONS = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** An inline, in-context message banner. For transient feedback use a Toast. */
export function Alert({ tone = 'info', title, children, onDismiss, className = '' }: AlertProps) {
  const IconCmp = ICONS[tone];
  return (
    <div className={`alert alert--${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon">
        <IconCmp size={18} />
      </span>
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__text">{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="alert__close" onClick={onDismiss} aria-label="Dismiss">
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}
