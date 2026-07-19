/**
 * Client-side validation that mirrors the backend's rules (src/utils/validation.js)
 * so users get instant feedback and the server stays the final authority.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_BYTES = 72;

export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  if (trimmed.length > 255) return 'Name must be at most 255 characters';
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email is required';
  if (!EMAIL_RE.test(trimmed)) return 'Enter a valid email address';
  if (trimmed.length > 255) return 'Email must be at most 255 characters';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (byteLength(password) > MAX_PASSWORD_BYTES) return 'Password is too long';
  if (!/[a-z]/.test(password)) return 'Add a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Add an uppercase letter';
  if (!/\d/.test(password)) return 'Add a number';
  return null;
}

export function validateRequired(value: string, label = 'This field'): string | null {
  return value.trim() ? null : `${label} is required`;
}

/** 0–4 strength score with a human label, for the password meter. */
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: 'Empty' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
}

/** Runs a map of field -> validator and returns only the fields that failed. */
export function validateForm<T extends Record<string, string>>(
  values: T,
  validators: Partial<Record<keyof T, (v: string) => string | null>>,
): Partial<Record<keyof T, string>> {
  const errors: Partial<Record<keyof T, string>> = {};
  for (const key in validators) {
    const validator = validators[key];
    if (validator) {
      const err = validator(values[key] ?? '');
      if (err) errors[key] = err;
    }
  }
  return errors;
}
