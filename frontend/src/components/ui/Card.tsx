import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** flat = border only; raised = subtle shadow. */
  elevation?: 'flat' | 'raised';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  elevation = 'flat',
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardProps) {
  const classes = ['card', `card--${elevation}`, `card--pad-${padding}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="card__header">
      <div className="card__heading">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h3 className="card__title">{title}</h3>
        {description && <p className="card__desc">{description}</p>}
      </div>
      {actions && <div className="card__actions">{actions}</div>}
    </div>
  );
}
