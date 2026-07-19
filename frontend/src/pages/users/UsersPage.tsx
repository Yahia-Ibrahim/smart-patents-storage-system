import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  RoleBadge,
  Select,
} from '@/components/ui';
import type { Column } from '@/components/ui';
import { ChevronRightIcon, PlusIcon, SearchIcon, UsersIcon } from '@/components/icons';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { userService } from '@/services/userService';
import type { AdminUser, Role } from '@/types';
import { formatDate, userRef } from '@/utils/format';
import { CreateAdminModal } from './CreateAdminModal';
import './Users.css';

const PAGE_SIZE = 10;

export function UsersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [modalOpen, setModalOpen] = useState(false);

  const debouncedSearch = useDebounced(search, 350);

  const { data, loading, error, refetch } = useAsync(
    (signal) =>
      userService.listUsers(
        {
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch.trim() || undefined,
          role: role || undefined,
        },
        signal,
      ),
    [page, debouncedSearch, role],
  );

  // Filters change the result set, so return to the first page.
  const onFilterChange = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        key: 'user',
        header: 'User',
        render: (u) => (
          <div className="users__cell-user">
            <Avatar name={u.name} size="sm" accent={u.role === 'admin'} />
            <div className="users__cell-id">
              <span className="users__cell-name">{u.name}</span>
              <span className="users__cell-email">{u.email}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'ref',
        header: 'Reference',
        hideOnMobile: true,
        render: (u) => <span className="ref">{userRef(u.id)}</span>,
      },
      { key: 'role', header: 'Role', render: (u) => <RoleBadge role={u.role} /> },
      {
        key: 'created',
        header: 'Created',
        hideOnMobile: true,
        render: (u) => <span className="users__muted">{formatDate(u.createdAt)}</span>,
      },
      {
        key: 'go',
        header: '',
        align: 'right',
        width: '48px',
        render: () => <ChevronRightIcon size={18} className="users__chevron" />,
      },
    ],
    [],
  );

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const hasFilters = Boolean(debouncedSearch.trim() || role);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="User Directory"
        description="Every account in the registry. Invite administrators and review who has access."
        actions={
          <Button leftIcon={<PlusIcon size={18} />} onClick={() => setModalOpen(true)}>
            Invite admin
          </Button>
        }
      />

      <Card padding="sm" className="users__toolbar">
        <div className="users__search">
          <Input
            type="search"
            placeholder="Search by name or email…"
            leftIcon={<SearchIcon size={18} />}
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            aria-label="Search users"
          />
        </div>
        <div className="users__filter">
          <Select
            value={role}
            onChange={(e) => onFilterChange(() => setRole(e.target.value as '' | Role))}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="admin">Administrators</option>
            <option value="user">Standard users</option>
          </Select>
        </div>
      </Card>

      {error ? (
        <Card padding="none">
          <ErrorState
            title="Couldn’t load the directory"
            message={error.message}
            onRetry={refetch}
          />
        </Card>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={data?.users ?? []}
            rowKey={(u) => u.id}
            loading={loading}
            skeletonRows={PAGE_SIZE}
            caption="User directory"
            onRowClick={(u) => navigate(`/users/${u.id}`)}
            empty={
              hasFilters ? (
                <EmptyState
                  icon={<SearchIcon size={26} />}
                  title="No matching users"
                  description="Try a different name, email, or role filter."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        onFilterChange(() => {
                          setSearch('');
                          setRole('');
                        })
                      }
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<UsersIcon size={26} />}
                  title="No users yet"
                  description="Accounts will appear here as people sign up."
                />
              )
            }
          />

          {!loading && total > 0 && (
            <div className="users__pagination">
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                summary={`Showing ${rangeStart}–${rangeEnd} of ${total}`}
              />
            </div>
          )}
        </>
      )}

      <CreateAdminModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={refetch} />
    </>
  );
}
