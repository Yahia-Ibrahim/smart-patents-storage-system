import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AdminRoute } from '@/routes/AdminRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { PatentsPage } from '@/pages/patents/PatentsPage';
import { PatentDetailPage } from '@/pages/patents/PatentDetailPage';
import { PatentFormPage } from '@/pages/patents/PatentFormPage';
import { PriorArtSearchPage } from '@/pages/patents/PriorArtSearchPage';
import { ReviewQueuePage } from '@/pages/patents/ReviewQueuePage';
import { ProfilePage } from '@/pages/ProfilePage';
import { DesignSystemPage } from '@/pages/DesignSystemPage';
import { UsersPage } from '@/pages/users/UsersPage';
import { UserDetailPage } from '@/pages/users/UserDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — redirected away once signed in */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>

        {/* Authenticated app shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            {/* Order matters: /patents/new and /patents/search must be
                matched before /patents/:id, or they are read as ids. */}
            <Route path="/patents" element={<PatentsPage />} />
            <Route path="/patents/new" element={<PatentFormPage />} />
            <Route path="/patents/search" element={<PriorArtSearchPage />} />
            <Route path="/patents/:id" element={<PatentDetailPage />} />
            <Route path="/patents/:id/edit" element={<PatentFormPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />

            {/* Admin-only */}
            <Route element={<AdminRoute />}>
              <Route path="/review-queue" element={<ReviewQueuePage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/:id" element={<UserDetailPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
