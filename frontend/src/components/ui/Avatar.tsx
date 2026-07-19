import { initials } from '@/utils/format';
import './Avatar.css';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Admin avatars carry the brass seal tone. */
  accent?: boolean;
}

// Deterministic hue from the name so a given person keeps the same swatch.
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

export function Avatar({ name, size = 'md', accent = false }: AvatarProps) {
  const style = accent
    ? undefined
    : ({
        '--avatar-bg': `hsl(${hueFor(name)} 42% 92%)`,
        '--avatar-fg': `hsl(${hueFor(name)} 46% 32%)`,
      } as React.CSSProperties);

  return (
    <span
      className={`avatar avatar--${size} ${accent ? 'avatar--accent' : ''}`}
      style={style}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </span>
  );
}
