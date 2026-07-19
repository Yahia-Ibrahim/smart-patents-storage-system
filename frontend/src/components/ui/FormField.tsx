import type { ReactNode } from 'react';
import { useId } from 'react';
import { AlertCircleIcon, CheckIcon } from '@/components/icons';
import './Field.css';

export interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  success?: string | null;
  required?: boolean;
  optional?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/**
 * Wraps a control with its label, hint, and validation message, and wires up
 * the aria-* relationships so the message is announced and the control is
 * marked invalid. Children is a render-prop receiving the generated ids.
 */
export function FormField({
  label,
  hint,
  error,
  success,
  required,
  optional,
  children,
}: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const msgId = `${id}-msg`;
  const invalid = Boolean(error);

  const describedBy = [hint ? hintId : null, error || success ? msgId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
          {required && (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          )}
          {optional && <span className="field__optional">(optional)</span>}
        </label>
      )}
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ id, describedBy, invalid })}
      {error && (
        <span className="field__message field__message--error" id={msgId} role="alert">
          <AlertCircleIcon size={14} />
          {error}
        </span>
      )}
      {!error && success && (
        <span className="field__message field__message--success" id={msgId}>
          <CheckIcon size={14} />
          {success}
        </span>
      )}
    </div>
  );
}
