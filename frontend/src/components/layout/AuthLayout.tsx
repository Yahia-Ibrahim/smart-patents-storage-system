import type { ReactNode } from 'react';
import { Brandmark } from '@/components/brand/Brandmark';
import { ThemeToggle } from './ThemeToggle';
import './AuthLayout.css';

// Each "figure" labels a property of the system in the vernacular of a patent
// drawing's part callouts — not a sequence, a labeled specification.
const FIGURES = [
  { fig: 'FIG. 01', title: 'Rotating sessions', body: 'Short-lived access tokens with refresh rotation and reuse detection.' },
  { fig: 'FIG. 02', title: 'Role-based access', body: 'A clean separation between applicants, examiners, and administrators.' },
  { fig: 'FIG. 03', title: 'Auditable by design', body: 'Every administrative action is attributable and recorded.' },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <Brandmark onDark size={34} />
        </div>

        <div className="auth__brand-body">
          <span className="eyebrow auth__eyebrow">Patent management, certified</span>
          <h1 className="auth__headline">
            The registry of record for your <em>intellectual property</em>.
          </h1>
          <p className="auth__lede">
            Submit, review, and retrieve patent filings with the precision the work demands — and
            the audit trail it requires.
          </p>

          <ul className="auth__figures">
            {FIGURES.map((f) => (
              <li key={f.fig} className="auth__figure">
                <span className="auth__figure-ref">{f.fig}</span>
                <div>
                  <p className="auth__figure-title">{f.title}</p>
                  <p className="auth__figure-body">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth__brand-foot">
          <span className="ref">SPS/IP · Reg. Instrument</span>
        </div>
      </aside>

      <main className="auth__panel">
        <div className="auth__panel-top">
          <div className="auth__panel-brand">
            <Brandmark size={28} />
          </div>
          <ThemeToggle />
        </div>
        <div className="auth__form-wrap">{children}</div>
        <footer className="auth__panel-foot">
          <span>© {new Date().getFullYear()} Smart Patents</span>
          <span className="ref">v1.0</span>
        </footer>
      </main>
    </div>
  );
}
