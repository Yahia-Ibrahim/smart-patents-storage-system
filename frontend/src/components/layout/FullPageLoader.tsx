import { Brandmark } from '@/components/brand/Brandmark';
import { Spinner } from '@/components/ui';
import './FullPageLoader.css';

/** Shown while the app verifies an existing session on first load. */
export function FullPageLoader() {
  return (
    <div className="full-loader">
      <Brandmark size={40} />
      <Spinner size={22} />
    </div>
  );
}
