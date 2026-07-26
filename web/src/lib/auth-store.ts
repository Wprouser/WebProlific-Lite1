const STORAGE_KEY = 'webprolific.session';

export interface SessionUser {
  id: string;
  // Not part of the /auth/login response (see Login.tsx) — filled in from a
  // follow-up GET /auth/me right after login, since the User model itself
  // has no display-name field to show instead.
  email: string;
  preferredLanguage: string;
  effectiveRole: string | undefined;
  effectiveOutletIds: string[];
}

export interface Session {
  accessToken: string;
  // Needed to call POST /auth/logout (which revokes this specific refresh
  // token server-side) — previously discarded entirely.
  refreshToken: string;
  user: SessionUser;
}

/**
 * Access-token-only session store — no refresh-token rotation wired up on
 * the frontend yet (that's its own follow-up); a 401 just clears the
 * session and sends the user back to /login. Good enough to unblock real
 * API testing without pulling in a token-refresh interceptor.
 */
export function getSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
