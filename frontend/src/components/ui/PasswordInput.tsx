import { forwardRef, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { EyeIcon, EyeOffIcon } from '@/components/icons';
import { passwordStrength } from '@/utils/validation';
import './Field.css';

export interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leftIcon?: ReactNode;
  /** Show a live strength meter beneath the field (for new-password fields). */
  showStrength?: boolean;
  value?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { invalid, leftIcon, showStrength = false, className = '', disabled, value = '', ...rest },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const strength = showStrength ? passwordStrength(String(value)) : null;

    const controlClasses = [
      'control',
      invalid ? 'control--error' : '',
      disabled ? 'control--disabled' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div className={controlClasses}>
          {leftIcon && <span className="control__affix">{leftIcon}</span>}
          <input
            ref={ref}
            type={visible ? 'text' : 'password'}
            className="control__input"
            disabled={disabled}
            value={value}
            aria-invalid={invalid || undefined}
            {...rest}
          />
          <button
            type="button"
            className="control__button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        </div>
        {strength && String(value).length > 0 && (
          <div className="strength">
            <div className="strength__bars" aria-hidden="true">
              {[1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className={`strength__bar ${strength.score >= level ? 'is-on' : ''}`}
                  data-level={Math.min(strength.score, 4)}
                />
              ))}
            </div>
            <span className="strength__label">Password strength: {strength.label}</span>
          </div>
        )}
      </div>
    );
  },
);
