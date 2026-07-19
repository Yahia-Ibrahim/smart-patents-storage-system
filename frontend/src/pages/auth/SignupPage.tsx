import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, FormField, Input, PasswordInput } from '@/components/ui';
import { LockIcon, MailIcon, UserIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ApiClientError } from '@/services/apiClient';
import { validateEmail, validateName, validatePassword } from '@/utils/validation';
import './Auth.css';

interface Errors {
  name?: string;
  email?: string;
  password?: string;
}

export function SignupPage() {
  const { signup } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nextErrors: Errors = {
      name: validateName(values.name) ?? undefined,
      email: validateEmail(values.email) ?? undefined,
      password: validatePassword(values.password) ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    try {
      await signup(values.name.trim(), values.email.trim(), values.password);
      toast.success('Account created', { description: 'Welcome to Smart Patents.' });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setErrors((prev) => ({ ...prev, email: 'That email is already registered.' }));
        } else if (err.status === 400 && err.details?.length) {
          const fieldErrors = err.fieldErrors();
          setErrors((prev) => ({ ...prev, ...fieldErrors }));
        } else if (err.status === 429) {
          setFormError('Too many sign-ups from this network. Please try again later.');
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('Could not reach the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <div className="auth-card__head">
          <h1 className="auth-card__title">Create your account</h1>
          <p className="auth-card__sub">Start managing patent filings in minutes.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <Alert tone="danger" className="auth-form__error" onDismiss={() => setFormError(null)}>
              {formError}
            </Alert>
          )}

          <FormField label="Full name" error={errors.name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="name"
                placeholder="Ada Lovelace"
                leftIcon={<UserIcon size={18} />}
                value={values.name}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={set('name')}
                autoFocus
              />
            )}
          </FormField>

          <FormField label="Email" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                placeholder="you@firm.com"
                leftIcon={<MailIcon size={18} />}
                value={values.email}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={set('email')}
              />
            )}
          </FormField>

          <FormField
            label="Password"
            error={errors.password}
            hint="At least 8 characters, with upper- and lower-case letters and a number."
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                placeholder="Create a password"
                leftIcon={<LockIcon size={18} />}
                value={values.password}
                invalid={invalid}
                showStrength
                aria-describedby={describedBy}
                onChange={set('password')}
              />
            )}
          </FormField>

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Create account
          </Button>
        </form>

        <p className="auth-card__foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
