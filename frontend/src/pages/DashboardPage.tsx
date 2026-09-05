import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, PageHeader, RoleBadge, Stat } from '@/components/ui';
import {
  CheckCircleIcon,
  FileIcon,
  PlusIcon,
  ReviewIcon,
  SealIcon,
  ShieldIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { userService } from '@/services/userService';
import { patentService } from '@/services/patentService';
import { formatDate, userRef } from '@/utils/format';
import './Dashboard.css';

/**
 * Registry counts.
 *
 * Each figure is a `limit: 1` list call read for its `pagination.total` rather
 * than a dedicated stats endpoint: the counts are already authoritative there,
 * already scoped to what this caller may see, and one endpoint that cannot
 * drift out of step with the list beats a second one that can.
 */
function RegistryStats({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const mine = useAsync(
    (signal) => patentService.list({ submittedBy: userId, limit: 1 }, signal),
    [userId],
  );
  const approved = useAsync(
    (signal) => patentService.list({ status: 'approved', limit: 1 }, signal),
    [],
  );
  // Non-admins see only their own pending filings here, which is the number
  // that matters to them: "how many of mine are waiting". For an admin the
  // same query is the whole queue.
  const pending = useAsync(
    (signal) =>
      patentService.list(
        { status: 'pending_admin', limit: 1, submittedBy: isAdmin ? undefined : userId },
        signal,
      ),
    [isAdmin, userId],
  );

  const loading = mine.loading || approved.loading || pending.loading;
  const failed = Boolean(mine.error || approved.error || pending.error);

  // An em dash rather than a fabricated 0: a failed count is unknown, and
  // "0 approved patents" is a claim this page has no right to make.
  const show = (n: number | undefined) => (failed ? '—' : (n ?? 0));

  return (
    <div className="dashboard__stats">
      <Stat
        label="Your filings"
        value={show(mine.data?.pagination.total)}
        loading={loading}
        icon={<FileIcon size={20} />}
        tone="brand"
      />
      <Stat
        label={isAdmin ? 'Awaiting review' : 'Yours in review'}
        value={show(pending.data?.pagination.total)}
        loading={loading}
        icon={<ReviewIcon size={20} />}
        tone="accent"
        hint={isAdmin ? 'Across every submitter' : undefined}
      />
      <Stat
        label="Approved patents"
        value={show(approved.data?.pagination.total)}
        loading={loading}
        icon={<CheckCircleIcon size={20} />}
        tone="success"
        hint="Searchable as prior art"
      />
    </div>
  );
}

function AdminStats() {
  const all = useAsync((signal) => userService.listUsers({ limit: 1 }, signal), []);
  const admins = useAsync((signal) => userService.listUsers({ role: 'admin', limit: 1 }, signal), []);

  const loading = all.loading || admins.loading;
  const failed = Boolean(all.error || admins.error);
  const total = all.data?.pagination.total;
  const adminCount = admins.data?.pagination.total;

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

      <RegistryStats isAdmin={isAdmin} userId={user.id} />

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
            <Link to="/patents/new" className="dashboard__action">
              <span className="dashboard__action-icon dashboard__action-icon--brand">
                <FileIcon size={20} />
              </span>
              <span className="dashboard__action-text">
                <strong>File a patent</strong>
                <small>Start a draft and submit it for review</small>
              </span>
            </Link>
            <Link to="/patents/search" className="dashboard__action">
              <span className="dashboard__action-icon dashboard__action-icon--accent">
                <SparkIcon size={20} />
              </span>
              <span className="dashboard__action-text">
                <strong>Search prior art</strong>
                <small>Find related filings by meaning, not keywords</small>
              </span>
            </Link>
            {isAdmin && (
              <Link to="/review-queue" className="dashboard__action">
                <span className="dashboard__action-icon dashboard__action-icon--brand">
                  <ReviewIcon size={20} />
                </span>
                <span className="dashboard__action-text">
                  <strong>Work the review queue</strong>
                  <small>Filings awaiting an examiner decision</small>
                </span>
              </Link>
            )}
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
            <p className="dashboard__note-title">Every filing carries an audit trail</p>
            <p className="dashboard__note-body">
              Submissions are analysed automatically for prior art, and every examiner decision is
              recorded against the filing with its reasoning. The analysis is advisory — a person
              makes the decision.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
