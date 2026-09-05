import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import './Field.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/**
 * Multi-line text, styled as the shared `.control`.
 *
 * Field.css already carried the `.control--textarea` variant before anything
 * used it — the design system anticipated this component. Adding it here rather
 * than styling a bare <textarea> per page is what keeps focus rings, error
 * borders and disabled states identical to Input and Select.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className = '', disabled, ...rest },
  ref,
) {
  const controlClasses = [
    'control',
    'control--textarea',
    invalid ? 'control--error' : '',
    disabled ? 'control--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={controlClasses}>
      <textarea
        ref={ref}
        className="control__input"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </div>
  );
});
