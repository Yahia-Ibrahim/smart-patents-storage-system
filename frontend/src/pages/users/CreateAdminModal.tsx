import { useState } from 'react';
import { Alert, Button, FormField, Input, Modal, PasswordInput } from '@/components/ui';
import { LockIcon, MailIcon, UserIcon } from '@/components/icons';
import { useToast } from '@/context/ToastContext';
import { ApiClientError } from '@/services/apiClient';
import { userService } from '@/services/userService';
import { validateEmail, validateName, validatePassword } from '@/utils/validation';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const EMPTY = { name: '', email: '', password: '' };

export function CreateAdminModal({ open, onClose, onCreated }: Props) {
  const toast = useToast();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<typeof EMPTY>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const reset = () => {
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const next = {
      name: validateName(values.name) ?? undefined,
      email: validateEmail(values.email) ?? undefined,
      password: validatePassword(values.password) ?? undefined,
    };
    setErrors(next);
    if (next.name || next.email || next.password) return;

    setSubmitting(true);
    try {
      await userService.createAdmin({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      toast.success('Administrator created', { description: `${values.email.trim()} can now sign in.` });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setErrors((prev) => ({ ...prev, email: 'That email is already registered.' }));
      } else if (err instanceof ApiClientError && err.status === 400) {
        setErrors(err.fieldErrors());
      } else if (err instanceof ApiClientError && err.status === 403) {
        setFormError('You no longer have permission to do this.');
      } else {
        setFormError('Could not create the administrator. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite an administrator"
      description="Admins can manage the directory and create other admins. This action is recorded against your account."
      dismissible={!submitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-admin-form" loading={submitting}>
            Create administrator
          </Button>
        </>
      }
    >
      <form id="create-admin-form" className="profile__form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <FormField label="Full name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={values.name}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<UserIcon size={18} />}
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
              value={values.email}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<MailIcon size={18} />}
              onChange={set('email')}
            />
          )}
        </FormField>
        <FormField
          label="Temporary password"
          error={errors.password}
          hint="Share this securely. The new admin can change it after signing in."
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              value={values.password}
              invalid={invalid}
              showStrength
              aria-describedby={describedBy}
              leftIcon={<LockIcon size={18} />}
              onChange={set('password')}
            />
          )}
        </FormField>
      </form>
    </Modal>
  );
}
