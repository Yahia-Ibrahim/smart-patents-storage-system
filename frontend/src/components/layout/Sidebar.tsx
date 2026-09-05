import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Brandmark } from '@/components/brand/Brandmark';
import {
  CloseIcon,
  DashboardIcon,
  FileIcon,
  ReviewIcon,
  SealIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuth } from '@/context/AuthContext';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon size={20} />, end: true },
  { to: '/patents', label: 'Patents', icon: <FileIcon size={20} />, end: true },
  { to: '/patents/search', label: 'Prior-art Search', icon: <SparkIcon size={20} /> },
  { to: '/review-queue', label: 'Review Queue', icon: <ReviewIcon size={20} />, adminOnly: true },
  { to: '/users', label: 'User Directory', icon: <UsersIcon size={20} />, adminOnly: true },
  { to: '/profile', label: 'My Profile', icon: <UserIcon size={20} /> },
  { to: '/design-system', label: 'Design System', icon: <SealIcon size={20} /> },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const items = NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <>
      <div
        className={`sidebar__scrim ${mobileOpen ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar__top">
          <NavLink to="/" className="sidebar__brand" onClick={onClose}>
            <Brandmark onDark size={30} />
          </NavLink>
          <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close menu">
            <CloseIcon size={20} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="Primary">
          <span className="sidebar__section">Workspace</span>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
            >
              <span className="sidebar__link-icon">{item.icon}</span>
              <span className="sidebar__link-label">{item.label}</span>
              {item.adminOnly && <span className="sidebar__link-tag">Admin</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__note">
            <SealIcon size={16} />
            <span>
              Every action is recorded to an <strong>auditable</strong> trail.
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
