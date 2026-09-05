import type { Role } from '@/types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
};

export const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
};

/** "3 days ago" / "just now" — for activity-style timestamps. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

export const roleLabel = (role: Role): string => (role === 'admin' ? 'Administrator' : 'User');

/** Up to two initials from a name, for avatars. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A short, monospace-friendly reference from a numeric id: 42 -> "USR-000042". */
export function userRef(id: string): string {
  return `USR-${id.padStart(6, '0')}`;
}

/** A short, monospace-friendly reference from a patent id: 42 -> "PAT-000042". */
export function patentRef(id: string): string {
  return `PAT-${id.padStart(6, '0')}`;
}

/** 0.7630 -> "76.3%". Similarity scores are 0..1 everywhere except the review row. */
export function similarityPercent(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * How a similarity score should read to a reviewer.
 *
 * The bands are a presentation choice, not a rule the system enforces: the AI
 * is advisory and gates nothing, so nothing downstream branches on these. They
 * exist so a reviewer scanning a list can tell 0.76 from 0.08 without doing
 * arithmetic.
 */
export function similarityTone(score: number): 'danger' | 'warning' | 'neutral' {
  if (score >= 0.75) return 'danger';
  if (score >= 0.45) return 'warning';
  return 'neutral';
}

/** Bytes -> "2.4 MB", for upload limits and file pickers. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
