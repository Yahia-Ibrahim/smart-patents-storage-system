import { useAuth } from '@/context/AuthContext';
import { ButtonLink } from '@/components/ui';
import { Brandmark } from '@/components/brand/Brandmark';
import './NotFound.css';

export function NotFoundPage() {
  const { status } = useAuth();
  const home = status === 'authenticated' ? '/' : '/login';

  return (
    <div className="notfound">
      <Brandmark size={40} />
      <span className="eyebrow notfound__code">Error · 404</span>
      <h1 className="notfound__title">This page isn’t on file</h1>
      <p className="notfound__text">
        The reference you followed doesn’t match any record in the registry. It may have been moved
        or never existed.
      </p>
      <ButtonLink to={home} size="lg">
        Back to {status === 'authenticated' ? 'dashboard' : 'sign in'}
      </ButtonLink>
    </div>
  );
}
