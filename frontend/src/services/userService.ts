import type { AdminUser, Profile, Role, UserListResult } from '@/types';
import { apiClient } from './apiClient';

export interface ListUsersParams {
  page?: number;
  limit?: number;
  role?: Role;
  search?: string;
}

export const userService = {
  updateProfile(input: { name?: string; email?: string }): Promise<Profile> {
    return apiClient.patch<Profile>('/users/me', input);
  },

  changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ message: string }> {
    return apiClient.put<{ message: string }>('/users/me/password', input);
  },

  createAdmin(input: { name: string; email: string; password: string }): Promise<AdminUser> {
    return apiClient.post<AdminUser>('/users/admins', input);
  },

  listUsers(params: ListUsersParams = {}, signal?: AbortSignal): Promise<UserListResult> {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.role) q.set('role', params.role);
    if (params.search) q.set('search', params.search);
    const qs = q.toString();
    return apiClient.get<UserListResult>(`/users${qs ? `?${qs}` : ''}`, { signal });
  },

  getUser(id: string, signal?: AbortSignal): Promise<AdminUser> {
    return apiClient.get<AdminUser>(`/users/${id}`, { signal });
  },
};
