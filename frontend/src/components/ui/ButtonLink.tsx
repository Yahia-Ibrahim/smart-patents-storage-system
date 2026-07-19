import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import type { ReactNode } from 'react';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/** A router Link that wears the Button's clothes — for navigation that should
 *  look like a button without nesting an <a> inside a <button>. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leftIcon,
  rightIcon,
  className = '',
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth ? 'btn--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link className={classes} {...rest}>
      {leftIcon && <span className="btn__icon">{leftIcon}</span>}
      {children && <span className="btn__label">{children}</span>}
      {rightIcon && <span className="btn__icon">{rightIcon}</span>}
    </Link>
  );
}
