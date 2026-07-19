import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import './Field.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

/** A text input styled as the shared `.control`. Pair with FormField for labels. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, success, leftIcon, rightSlot, className = '', disabled, ...rest },
  ref,
) {
  const controlClasses = [
    'control',
    invalid ? 'control--error' : '',
    success && !invalid ? 'control--success' : '',
    disabled ? 'control--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={controlClasses}>
      {leftIcon && <span className="control__affix">{leftIcon}</span>}
      <input
        ref={ref}
        className="control__input"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {rightSlot}
    </div>
  );
});
