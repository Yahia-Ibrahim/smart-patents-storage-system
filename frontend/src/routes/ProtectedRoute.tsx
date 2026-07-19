import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuth } from '@/context/AuthContext';

/** Gate for any authenticated route. Redirects guests to /login, preserving
 *  where they were headed so login can send them back. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
