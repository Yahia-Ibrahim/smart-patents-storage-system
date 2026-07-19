import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  PasswordInput,
  RoleBadge,
  Tabs,
} from '@/components/ui';
import { LockIcon, MailIcon, ShieldIcon, UserIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ApiClientError } from '@/services/apiClient';
import { userService } from '@/services/userService';
import { formatDate, userRef } from '@/utils/format';
import { validateEmail, validateName, validatePassword } from '@/utils/validation';
import './Profile.css';

function ProfileDetails() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  const dirty = name.trim() !== user.name || email.trim() !== user.email;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      name: validateName(name) ?? undefined,
      email: validateEmail(email) ?? undefined,
    };
    setErrors(next);
    if (next.name || next.email) return;

    setSaving(true);
    try {
      const payload: { name?: string; email?: string } = {};
      if (name.trim() !== user.name) payload.name = name.trim();
      if (email.trim() !== user.email) payload.email = email.trim();
      const updated = await userService.updateProfile(payload);
      setUser(updated);
      toast.success('Profile updated');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setErrors({ email: 'That email is already registered.' });
      } else if (err instanceof ApiClientError && err.status === 400) {
        setErrors(err.fieldErrors());
      } else {
        toast.error('Could not update profile', {
          description: err instanceof ApiClientError ? err.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card elevation="raised" className="profile__panel">
      <form className="profile__form" onSubmit={submit} noValidate>
        <FormField label="Full name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<UserIcon size={18} />}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              value={email}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<MailIcon size={18} />}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </FormField>
        <div className="profile__form-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setName(user.name);
              setEmail(user.email);
              setErrors({});
            }}
          >
            Reset
          </Button>
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SecuritySettings() {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [values, setValues] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      current: values.current ? undefined : 'Enter your current password',
      next: validatePassword(values.next) ?? undefined,
      confirm: values.next !== values.confirm ? 'Passwords do not match' : undefined,
    };
    if (!next.next && values.next === values.current) {
      next.next = 'Choose a password different from your current one';
    }
    setErrors(next);
    if (next.current || next.next || next.confirm) return;

    setSaving(true);
    try {
      await userService.changePassword({
        currentPassword: values.current,
        newPassword: values.next,
      });
      // The backend revokes every session on password change, so the honest
      // thing to do is send the user back to sign in with the new password.
      toast.success('Password changed', { description: 'Please sign in again.' });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setErrors({ current: 'Current password is incorrect' });
      } else if (err instanceof ApiClientError && err.status === 400) {
        setErrors(err.fieldErrors());
      } else {
        toast.error('Could not change password');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card elevation="raised" className="profile__panel">
      <form className="profile__form" onSubmit={submit} noValidate>
        <FormField label="Current password" error={errors.current}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              value={values.current}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<LockIcon size={18} />}
              onChange={set('current')}
            />
          )}
        </FormField>
        <FormField
          label="New password"
          error={errors.next}
          hint="At least 8 characters, with upper- and lower-case letters and a number."
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              value={values.next}
              invalid={invalid}
              showStrength
              aria-describedby={describedBy}
              leftIcon={<LockIcon size={18} />}
              onChange={set('next')}
            />
          )}
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              value={values.confirm}
              invalid={invalid}
              aria-describedby={describedBy}
              leftIcon={<LockIcon size={18} />}
              onChange={set('confirm')}
            />
          )}
        </FormField>
        <div className="profile__form-actions">
          <Button type="submit" loading={saving}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('details');
  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Account" title="My Profile" description="Manage your account details and security." />

      <div className="profile__layout">
        <Card elevation="raised" className="profile__summary">
          <div className="profile__summary-top">
            <Avatar name={user.name} size="xl" accent={user.role === 'admin'} />
            <h2 className="profile__summary-name">{user.name}</h2>
            <p className="profile__summary-email">{user.email}</p>
            <RoleBadge role={user.role} />
          </div>
          <dl className="profile__facts">
            <div>
              <dt>Reference</dt>
              <dd className="ref">{userRef(user.id)}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Inventor profile</dt>
              <dd>
                {user.inventorProfile ? (
                  <Badge tone="success" dot>
                    Linked
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not linked</Badge>
                )}
              </dd>
            </div>
          </dl>
          {user.inventorProfile && (
            <div className="profile__inventor">
              <span className="eyebrow">Inventor of record</span>
              <p className="profile__inventor-name">{user.inventorProfile.fullName}</p>
              {user.inventorProfile.organization && (
                <p className="profile__inventor-org">{user.inventorProfile.organization}</p>
              )}
            </div>
          )}
        </Card>

        <div className="profile__main">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'details', label: 'Profile details', icon: <UserIcon size={18} /> },
              { id: 'security', label: 'Security', icon: <ShieldIcon size={18} /> },
            ]}
          />
          <div className="profile__tab-body">
            {tab === 'details' ? <ProfileDetails /> : <SecuritySettings />}
          </div>
        </div>
      </div>
    </>
  );
}
