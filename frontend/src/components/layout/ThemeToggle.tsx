import { MoonIcon, SunIcon } from '@/components/icons';
import { useTheme } from '@/context/ThemeContext';
import './ThemeToggle.css';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const nextIsDark = theme === 'light';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${nextIsDark ? 'dark' : 'light'} theme`}
      title={`Switch to ${nextIsDark ? 'dark' : 'light'} theme`}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__thumb">
          {theme === 'light' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
        </span>
      </span>
    </button>
  );
}
