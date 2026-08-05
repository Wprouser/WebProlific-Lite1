import {
  clearSession,
  getSession,
  markSessionExpired,
  updateSessionTokens,
} from './auth-store';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Endpoints where a 401 is a legitimate answer about the *credentials being
 * submitted*, not a sign that the current access token went stale. Trying to
 * silently refresh on these would be wrong twice over: it would swallow the
 * "wrong password" / "bad code" message the caller needs to render inline,
 * and `/auth/refresh` returning 401 would recurse into itself.
 */
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/2fa/verify',
  '/auth/2fa/backup-code',
  '/auth/2fa/resend',
  '/auth/forgot-password',
  '/auth/reset-password',
];

/**
 * In-flight refresh, shared by every request that 401s at the same moment.
 * Without this, a screen that fires four parallel loads on mount would send
 * four refresh calls; since AuthService.refresh rotates single-use tokens,
 * the first would succeed and the rest would 401 on an already-revoked
 * token, logging the user out immediately after a successful refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const session = getSession();
  if (!session?.refreshToken) return null;

  // Raw fetch, not `request()` — going back through the wrapper would
  // re-enter this same 401 handling.
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { accessToken: string; refreshToken: string };
  updateSessionTokens(body.accessToken, body.refreshToken);
  return body.accessToken;
}

function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= refreshAccessToken()
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function expireSession(): never {
  clearSession();
  markSessionExpired();
  window.location.assign('/login');
  throw new ApiError(401, 'Session expired');
}

/**
 * Runs `send` with the current access token. On a 401 for an authenticated
 * request, exchanges the refresh token once and replays the request with the
 * new access token; if that exchange fails, the session is genuinely over —
 * clear it and bounce to /login with an explanation (FR-13: "expired/invalid
 * refresh token forces re-login, never silently fails open").
 */
async function sendAuthed(
  path: string,
  send: (token: string | null) => Promise<Response>,
): Promise<Response> {
  const session = getSession();
  let response = await send(session?.accessToken ?? null);

  if (response.status !== 401) return response;

  // No session, or an endpoint whose 401 is about the submitted credentials:
  // hand the 401 back to the caller to render inline.
  if (!session || NO_REFRESH_PATHS.some((p) => path.startsWith(p))) return response;

  const newToken = await refreshOnce();
  if (!newToken) expireSession();

  response = await send(newToken);
  if (response.status === 401) expireSession();
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  return new ApiError(
    response.status,
    body?.message ?? `Request failed (${response.status})`,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sendAuthed(path, (token) => {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await sendAuthed(path, (token) => {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { headers });
  });

  if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status})`);
  return response.blob();
}

async function requestForm<T>(path: string, method: string, formData: FormData): Promise<T> {
  const response = await sendAuthed(path, (token) => {
    const headers = new Headers();
    // Deliberately no Content-Type here — the browser sets
    // multipart/form-data with the correct boundary itself when the body is
    // a FormData instance; setting it manually would drop the boundary.
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { method, headers, body: formData });
  });

  if (!response.ok) throw await toApiError(response);
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
  getBlob: (path: string) => requestBlob(path),
};
