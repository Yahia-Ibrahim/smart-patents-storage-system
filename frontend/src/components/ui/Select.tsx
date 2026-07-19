import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import './Field.css';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className = '', disabled, children, ...rest },
  ref,
) {
  const controlClasses = [
    'control',
    'control--select',
    invalid ? 'control--error' : '',
    disabled ? 'control--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={controlClasses}>
      <select
        ref={ref}
        className="control__select"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon size={16} className="control__chevron" />
    </div>
  );
});
