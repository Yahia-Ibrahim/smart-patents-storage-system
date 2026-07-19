import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui';
import { ChevronDownIcon, LogOutIcon, MenuIcon, UserIcon } from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { roleLabel } from '@/utils/format';
import { ThemeToggle } from './ThemeToggle';
import './Topbar.css';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    try {
      await logout();
      toast.success('Signed out');
      navigate('/login');
    } catch {
      toast.error('Could not sign out cleanly', { description: 'Your local session was cleared.' });
      navigate('/login');
    }
  };

  if (!user) return null;

  return (
    <header className="topbar">
      <button type="button" className="topbar__menu" onClick={onMenu} aria-label="Open menu">
        <MenuIcon size={22} />
      </button>

      <div className="topbar__spacer" />

      <div className="topbar__actions">
        <ThemeToggle />
        <div className="topbar__divider" />
        <div className="usermenu" ref={menuRef}>
          <button
            type="button"
            className="usermenu__trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar name={user.name} size="sm" accent={user.role === 'admin'} />
            <span className="usermenu__id">
              <span className="usermenu__name">{user.name}</span>
              <span className="usermenu__role">{roleLabel(user.role)}</span>
            </span>
            <ChevronDownIcon size={16} className="usermenu__chevron" />
          </button>

          {menuOpen && (
            <div className="usermenu__pop" role="menu">
              <div className="usermenu__header">
                <Avatar name={user.name} size="md" accent={user.role === 'admin'} />
                <div className="usermenu__meta">
                  <span className="usermenu__name">{user.name}</span>
                  <span className="usermenu__email">{user.email}</span>
                </div>
              </div>
              <div className="usermenu__sep" />
              <Link to="/profile" role="menuitem" className="usermenu__item" onClick={() => setMenuOpen(false)}>
                <UserIcon size={18} />
                My Profile
              </Link>
              <button type="button" role="menuitem" className="usermenu__item usermenu__item--danger" onClick={handleLogout}>
                <LogOutIcon size={18} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
