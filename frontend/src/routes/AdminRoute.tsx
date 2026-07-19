import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

/** Gate for admin-only routes. A signed-in non-admin is bounced to the
 *  dashboard rather than the login screen — they're authenticated, just not
 *  authorized. */
export function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
