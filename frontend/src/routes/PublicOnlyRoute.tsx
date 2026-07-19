import { Navigate, Outlet } from 'react-router-dom';
import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuth } from '@/context/AuthContext';

/** For /login and /signup: a signed-in user has no reason to see these, so
 *  send them to the dashboard. */
export function PublicOnlyRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
