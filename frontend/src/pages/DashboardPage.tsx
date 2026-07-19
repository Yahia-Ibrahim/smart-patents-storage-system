import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, PageHeader, RoleBadge, Stat } from '@/components/ui';
import {
  FileIcon,
  PlusIcon,
  SealIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { userService } from '@/services/userService';
import { formatDate, userRef } from '@/utils/format';
import './Dashboard.css';

function AdminStats() {
  const all = useAsync((signal) => userService.listUsers({ limit: 1 }, signal), []);
  const admins = useAsync((signal) => userService.listUsers({ role: 'admin', limit: 1 }, signal), []);

  const loading = all.loading || admins.loading;
  const failed = Boolean(all.error || admins.error);
  const total = all.data?.pagination.total;
  const adminCount = admins.data?.pagination.total;

  // Don't invent a "0" when a fetch failed — an em dash reads as "unknown".
  const show = (n: number | undefined) => (failed ? '—' : (n ?? 0));

  return (
    <div className="dashboard__stats">
      <Stat
        label="Total accounts"
        value={show(total)}
        loading={loading}
        icon={<UsersIcon size={20} />}
        tone="brand"
      />
      <Stat
        label="Administrators"
        value={show(adminCount)}
        loading={loading}
        icon={<ShieldIcon size={20} />}
        tone="accent"
      />
      <Stat
        label="Standard users"
        value={failed || total === undefined || adminCount === undefined ? '—' : Math.max(total - adminCount, 0)}
        loading={loading}
        icon={<UserIcon size={20} />}
        tone="neutral"
      />
    </div>
  );
}

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  if (!user) return null;

  const firstName = user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        description="Here's the state of your patent registry workspace."
      />

      {isAdmin && <AdminStats />}

      <div className="dashboard__grid">
        <Card elevation="raised" className="dashboard__account">
          <div className="dashboard__account-head">
            <div>
              <span className="eyebrow">Account</span>
              <h2 className="dashboard__account-name">{user.name}</h2>
              <p className="dashboard__account-email">{user.email}</p>
            </div>
            <RoleBadge role={user.role} />
          </div>
          <dl className="dashboard__meta">
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
          <div className="dashboard__account-actions">
            <ButtonLink to="/profile" variant="secondary" size="sm">
              Manage profile
            </ButtonLink>
          </div>
        </Card>

        <Card elevation="raised" className="dashboard__actions">
          <span className="eyebrow">Quick actions</span>
          <h2 className="dashboard__actions-title">Get things done</h2>
          <div className="dashboard__action-list">
            <Link to="/patents" className="dashboard__action">
              <span className="dashboard__action-icon dashboard__action-icon--brand">
                <FileIcon size={20} />
              </span>
              <span className="dashboard__action-text">
                <strong>Browse patents</strong>
                <small>Search and review filings</small>
              </span>
            </Link>
            <Link to="/profile" className="dashboard__action">
              <span className="dashboard__action-icon dashboard__action-icon--neutral">
                <UserIcon size={20} />
              </span>
              <span className="dashboard__action-text">
                <strong>Update your profile</strong>
                <small>Name, email, and password</small>
              </span>
            </Link>
            {isAdmin && (
              <Link to="/users" className="dashboard__action">
                <span className="dashboard__action-icon dashboard__action-icon--accent">
                  <PlusIcon size={20} />
                </span>
                <span className="dashboard__action-text">
                  <strong>Manage the directory</strong>
                  <small>Invite admins, review accounts</small>
                </span>
              </Link>
            )}
          </div>
        </Card>
      </div>

      <Card className="dashboard__note-card">
        <div className="dashboard__note">
          <span className="dashboard__note-seal">
            <SealIcon size={22} />
          </span>
          <div>
            <p className="dashboard__note-title">Patents module — coming next</p>
            <p className="dashboard__note-body">
              Filing submission, AI pre-screening, and examiner review reuse this same design
              language. This workspace is ready to grow with them.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
