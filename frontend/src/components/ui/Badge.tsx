import type { ReactNode } from 'react';
import type { Role } from '@/types';
import './Badge.css';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Stamp = uppercase mono with a ruled border, the "certified" look. */
  variant?: 'soft' | 'stamp';
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  icon,
  children,
  className = '',
}: BadgeProps) {
  const classes = ['badge', `badge--${tone}`, `badge--${variant}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {icon && <span className="badge__icon">{icon}</span>}
      {children}
    </span>
  );
}

/** Role badge — admins carry the brass "seal" tone. */
export function RoleBadge({ role }: { role: Role }) {
  return role === 'admin' ? (
    <Badge tone="accent" variant="stamp">
      Admin
    </Badge>
  ) : (
    <Badge tone="neutral" variant="soft">
      User
    </Badge>
  );
}

// Patent status is not part of the Users module, but the mapping lives here so
// the future Patents UI reuses the exact same badge language.
const PATENT_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  approved: { tone: 'success', label: 'Approved' },
  declined: { tone: 'danger', label: 'Declined' },
  pending_ai: { tone: 'warning', label: 'Pending AI' },
  pending_admin: { tone: 'brand', label: 'Pending Review' },
  draft: { tone: 'neutral', label: 'Draft' },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = PATENT_STATUS[status] ?? { tone: 'neutral' as BadgeTone, label: status };
  return (
    <Badge tone={cfg.tone} variant="stamp" dot>
      {cfg.label}
    </Badge>
  );
}
