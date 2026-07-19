import { useNavigate, useParams } from 'react-router-dom';
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  ErrorState,
  RoleBadge,
  Skeleton,
} from '@/components/ui';
import { ArrowLeftIcon } from '@/components/icons';
import { useAsync } from '@/hooks/useAsync';
import { userService } from '@/services/userService';
import { formatDateTime, userRef } from '@/utils/format';
import './Users.css';

export function UserDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: user, loading, error, refetch } = useAsync(
    (signal) => userService.getUser(id, signal),
    [id],
  );

  return (
    <>
      <button type="button" className="detail__back" onClick={() => navigate('/users')}>
        <ArrowLeftIcon size={16} />
        Back to directory
      </button>

      {loading && (
        <Card elevation="raised" className="detail__card">
          <div className="detail__head">
            <Skeleton width={72} height={72} radius="var(--radius-full)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <Skeleton width={200} height={22} />
              <Skeleton width={160} height={14} />
            </div>
          </div>
        </Card>
      )}

      {!loading && error && (
        <Card padding="none">
          <ErrorState
            title={error.status === 404 ? 'User not found' : 'Couldn’t load this user'}
            message={
              error.status === 404
                ? 'This account may have been removed, or the reference is incorrect.'
                : error.message
            }
            onRetry={error.status === 404 ? undefined : refetch}
          />
          {error.status === 404 && (
            <div style={{ textAlign: 'center', paddingBottom: 'var(--space-8)' }}>
              <ButtonLink to="/users" variant="secondary" size="sm">
                Return to directory
              </ButtonLink>
            </div>
          )}
        </Card>
      )}

      {!loading && user && (
        <Card elevation="raised" className="detail__card">
          <div className="detail__head">
            <Avatar name={user.name} size="xl" accent={user.role === 'admin'} />
            <div className="detail__head-text">
              <h1 className="detail__name">{user.name}</h1>
              <p className="detail__email">{user.email}</p>
              <div className="detail__badges">
                <RoleBadge role={user.role} />
                {user.createdBy === null && user.role === 'admin' && (
                  <Badge tone="neutral" variant="stamp">
                    Root / Seed
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <dl className="detail__facts">
            <div>
              <dt>Reference</dt>
              <dd className="ref">{userRef(user.id)}</dd>
            </div>
            <div>
              <dt>Account ID</dt>
              <dd className="ref">{user.id}</dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>
                {user.createdBy ? (
                  <span className="ref">{userRef(user.createdBy)}</span>
                ) : (
                  <span className="users__muted">— (self-registered or seeded)</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDateTime(user.updatedAt)}</dd>
            </div>
          </dl>
        </Card>
      )}
    </>
  );
}
