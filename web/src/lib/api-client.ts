import { clearSession, getSession } from './auth-store';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    clearSession();
    window.location.assign('/login');
    throw new ApiError(401, 'Session expired');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.message ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestForm<T>(path: string, method: string, formData: FormData): Promise<T> {
  const session = getSession();
  const headers = new Headers();
  // Deliberately no Content-Type here — the browser sets
  // multipart/form-data with the correct boundary itself when the body is
  // a FormData instance; setting it manually would drop the boundary.
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`${API_BASE}${path}`, { method, headers, body: formData });

  if (response.status === 401) {
    clearSession();
    window.location.assign('/login');
    throw new ApiError(401, 'Session expired');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData) => requestForm<T>(path, 'POST', formData),
};
