import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, FormField, Input, PasswordInput } from '@/components/ui';
import { LockIcon, MailIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ApiClientError } from '@/services/apiClient';
import { validateEmail, validateRequired } from '@/utils/validation';
import './Auth.css';

interface Errors {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nextErrors: Errors = {
      email: validateEmail(email) ?? undefined,
      password: validateRequired(password, 'Password') ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      toast.success('Welcome back');
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 429) {
          setFormError('Too many attempts. Please wait a few minutes and try again.');
        } else if (err.status === 401) {
          setFormError('Invalid email or password.');
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
          <h1 className="auth-card__title">Sign in</h1>
          <p className="auth-card__sub">Access your patent registry workspace.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <Alert tone="danger" className="auth-form__error" onDismiss={() => setFormError(null)}>
              {formError}
            </Alert>
          )}

          <FormField label="Email" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                placeholder="you@firm.com"
                leftIcon={<MailIcon size={18} />}
                value={email}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            )}
          </FormField>

          <FormField label="Password" error={errors.password}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                placeholder="Your password"
                leftIcon={<LockIcon size={18} />}
                value={password}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </FormField>

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Sign in
          </Button>
        </form>

        <p className="auth-card__foot">
          New to Smart Patents? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
