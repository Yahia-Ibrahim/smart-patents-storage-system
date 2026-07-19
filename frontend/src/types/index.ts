// Domain and API types. These mirror the backend DTOs in src/utils/dto.js.

export type Role = 'user' | 'admin';

export interface InventorProfile {
  id: string;
  fullName: string;
  email: string;
  organization: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser extends User {
  createdBy: string | null;
}

export interface Profile extends User {
  inventorProfile: InventorProfile | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: User;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserListResult {
  users: AdminUser[];
  pagination: Pagination;
}

// The backend's uniform envelope.
export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: ApiError };
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
