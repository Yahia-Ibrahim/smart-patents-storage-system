import type { AuthTokens } from '@/types';

/**
 * Where the SPA keeps its tokens.
 *
 * The backend returns tokens in the JSON body (not httpOnly cookies), so the
 * client has to hold them. localStorage survives reloads and is the pragmatic
 * choice here; the tradeoff is XSS exposure, mitigated by the app shipping no
 * third-party scripts and the access token being short-lived. If the backend
 * later moves to httpOnly refresh cookies, only this module changes.
 */
const ACCESS_KEY = 'sp.accessToken';
const REFRESH_KEY = 'sp.refreshToken';

type Listener = () => void;
const listeners = new Set<Listener>();

export const tokenStore = {
  getAccess(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: AuthTokens): void {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    listeners.forEach((fn) => fn());
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    listeners.forEach((fn) => fn());
  },
  /** Subscribe to token changes (e.g. logout in another tab). */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
