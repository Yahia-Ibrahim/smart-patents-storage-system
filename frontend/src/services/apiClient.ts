import type { ApiEnvelope, ApiErrorDetail, AuthTokens } from '@/types';
import { tokenStore } from './tokenStore';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * A failed API call, normalized. Carries everything the UI needs to render a
 * meaningful message: HTTP status, the backend error `code`, and per-field
 * validation `details`.
 */
export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Collapses field-level details into a { field: message } lookup for forms. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) {
      if (!(d.field in out)) out[d.field] = d.message;
    }
    return out;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the Authorization header (public endpoints). */
  auth?: boolean;
  /** Skip the 401 -> refresh -> retry dance (used by the refresh call itself). */
  allowRefresh?: boolean;
  signal?: AbortSignal;
}

// Dedupe concurrent refreshes: many requests can 401 at once, but only one
// refresh should run. The rest await the same promise.
let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function runRefresh(): Promise<AuthTokens | null> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/users/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = (await res.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
    if (!res.ok || !json.success) {
      tokenStore.clear();
      return null;
    }
    const tokens = { accessToken: json.data.accessToken, refreshToken: json.data.refreshToken };
    tokenStore.set(tokens);
    return tokens;
  } catch {
    tokenStore.clear();
    return null;
  }
}

function refreshTokens(): Promise<AuthTokens | null> {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function parse<T>(res: Response): Promise<T> {
  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // Non-JSON response (proxy error, 502, etc.)
    throw new ApiClientError(res.status, 'NETWORK', 'The server returned an unexpected response.');
  }

  if (res.ok && json.success) return json.data;

  if (!json.success) {
    throw new ApiClientError(res.status, json.error.code, json.error.message, json.error.details);
  }
  throw new ApiClientError(res.status, 'UNKNOWN', 'Something went wrong.');
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, allowRefresh = true, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
  }

  // Access token likely expired — refresh once and retry transparently.
  if (res.status === 401 && auth && allowRefresh && tokenStore.getRefresh()) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed.accessToken}`;
      res = await doFetch();
    }
  }

  return parse<T>(res);
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'DELETE' }),
};
