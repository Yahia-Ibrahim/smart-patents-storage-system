import type { AuthResult, Profile } from '@/types';
import { apiClient } from './apiClient';
import { tokenStore } from './tokenStore';

export const authService = {
  async signup(input: { name: string; email: string; password: string }): Promise<AuthResult> {
    const data = await apiClient.post<AuthResult>('/users/signup', input, { auth: false });
    tokenStore.set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data;
  },

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const data = await apiClient.post<AuthResult>('/users/login', input, { auth: false });
    tokenStore.set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data;
  },

  async me(signal?: AbortSignal): Promise<Profile> {
    return apiClient.get<Profile>('/users/me', { signal });
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStore.getRefresh();
    try {
      await apiClient.post('/users/logout', { refreshToken });
    } finally {
      // Local session is cleared regardless of whether the server call succeeds.
      tokenStore.clear();
    }
  },
};
