const STORAGE_KEY = 'webprolific.session';
const TRUSTED_DEVICE_KEY = 'webprolific.trustedDevice';
const SESSION_EXPIRED_KEY = 'webprolific.sessionExpired';

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
  // Exchanged for a fresh access token by api-client's silent-refresh path,
  // and revoked server-side by POST /auth/logout.
  refreshToken: string;
  user: SessionUser;
}

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

/**
 * Swaps in a rotated token pair while leaving the cached user profile alone.
 * POST /auth/refresh rotates the refresh token (single-use — see
 * AuthService.refresh), so persisting the *new* one matters: keeping the old
 * one would make the next refresh fail and log the user out spuriously.
 */
export function updateSessionTokens(accessToken: string, refreshToken: string): void {
  const current = getSession();
  if (!current) return;
  setSession({ ...current, accessToken, refreshToken });
}

/**
 * FR-13 "Trust this device for 30 days". Deliberately stored under its own
 * key rather than inside Session: it has to outlive logout and session
 * expiry, since its whole purpose is to skip the 2FA challenge on the *next*
 * login from this browser. The server still enforces its expiry
 * (TrustedDevice.expiresAt) — a stale value here is simply ignored and the
 * challenge is re-triggered.
 */
export function getTrustedDeviceToken(): string | null {
  return localStorage.getItem(TRUSTED_DEVICE_KEY);
}

export function setTrustedDeviceToken(token: string): void {
  localStorage.setItem(TRUSTED_DEVICE_KEY, token);
}

export function clearTrustedDeviceToken(): void {
  localStorage.removeItem(TRUSTED_DEVICE_KEY);
}

/**
 * One-shot flag telling the Login screen to explain *why* the user landed
 * back there. sessionStorage rather than localStorage because it's a
 * transient message about this tab's last action, not durable state — and it
 * has to survive the full page load that api-client's redirect triggers,
 * which in-memory state would not.
 */
export function markSessionExpired(): void {
  sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
}

export function consumeSessionExpired(): boolean {
  const flagged = sessionStorage.getItem(SESSION_EXPIRED_KEY) === '1';
  if (flagged) sessionStorage.removeItem(SESSION_EXPIRED_KEY);
  return flagged;
}
