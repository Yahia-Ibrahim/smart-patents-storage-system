import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile, User } from '@/types';
import { authService } from '@/services/authService';
import { tokenStore } from '@/services/tokenStore';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: Profile | null;
  status: AuthStatus;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Merge a fresh profile in after a mutation (edit profile) without a refetch. */
  setUser: (user: Profile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const hydrate = useCallback(async (signal?: AbortSignal) => {
    if (!tokenStore.getAccess() && !tokenStore.getRefresh()) {
      setStatus('guest');
      return;
    }
    try {
      const profile = await authService.me(signal);
      setUserState(profile);
      setStatus('authenticated');
    } catch (err) {
      // An aborted request (StrictMode re-run, unmount, or navigation during
      // hydration) is not an auth failure — clearing tokens here would log the
      // user out of a perfectly valid session. Only a real rejection should.
      if ((err as Error).name === 'AbortError' || signal?.aborted) return;
      tokenStore.clear();
      setUserState(null);
      setStatus('guest');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void hydrate(controller.signal);
    return () => controller.abort();
  }, [hydrate]);

  // If tokens are cleared elsewhere (another tab logs out, a refresh fails),
  // reflect that here.
  useEffect(() => {
    return tokenStore.subscribe(() => {
      if (!tokenStore.getRefresh()) {
        setUserState(null);
        setStatus('guest');
      }
    });
  }, []);

  const afterAuth = useCallback((authed: User) => {
    // login/signup return the base user; enrich to a full Profile shape.
    setUserState({ ...authed, inventorProfile: null });
    setStatus('authenticated');
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authService.login({ email, password });
      afterAuth(result.user);
    },
    [afterAuth],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      const result = await authService.signup({ name, email, password });
      afterAuth(result.user);
    },
    [afterAuth],
  );

  const logout = useCallback(async () => {
    await authService.logout();
    setUserState(null);
    setStatus('guest');
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await authService.me();
    setUserState(profile);
  }, []);

  const setUser = useCallback((profile: Profile) => setUserState(profile), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAdmin: user?.role === 'admin',
      login,
      signup,
      logout,
      refreshProfile,
      setUser,
    }),
    [user, status, login, signup, logout, refreshProfile, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
