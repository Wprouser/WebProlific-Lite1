import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from './api-client';
import { getSession, setSession } from './auth-store';

const assign = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function seedSession() {
  setSession({
    accessToken: 'stale-access',
    refreshToken: 'refresh-1',
    user: {
      id: 'u1',
      email: 'owner@example.com',
      preferredLanguage: 'en',
      effectiveRole: 'CHAIN_OWNER',
      effectiveOutletIds: ['o1'],
    },
  });
}

function authHeaderOf(call: unknown[]): string | null {
  const init = call[1] as RequestInit;
  return new Headers(init.headers).get('Authorization');
}

describe('api-client silent refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
    // jsdom's location.assign is unimplemented and throws.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, pathname: '/items' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC: a 401 on an authenticated call refreshes and replays the request', async () => {
    seedSession();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'refresh-2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 'i1' }]));

    await expect(apiClient.get('/items')).resolves.toEqual([{ id: 'i1' }]);

    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh');
    // The replay must carry the NEW token, not the stale one.
    expect(authHeaderOf(fetchMock.mock.calls[2])).toBe('Bearer fresh-access');
    expect(assign).not.toHaveBeenCalled();

    // Rotation is single-use server-side, so the rotated refresh token has to
    // be the one we keep.
    const session = getSession();
    expect(session?.accessToken).toBe('fresh-access');
    expect(session?.refreshToken).toBe('refresh-2');
  });

  it('AC: an expired refresh token forces re-login and never fails open', async () => {
    seedSession();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid or expired refresh token' }));

    await expect(apiClient.get('/items')).rejects.toBeInstanceOf(ApiError);

    expect(getSession()).toBeNull();
    expect(sessionStorage.getItem('webprolific.sessionExpired')).toBe('1');
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('AC: concurrent 401s share one refresh, so rotation does not race itself', async () => {
    seedSession();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'refresh-2' }),
        );
      }
      const token = new Headers(init?.headers).get('Authorization');
      return Promise.resolve(
        token === 'Bearer fresh-access'
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { message: 'Unauthorized' }),
      );
    });

    await Promise.all([
      apiClient.get('/items'),
      apiClient.get('/suppliers'),
      apiClient.get('/tax-rates'),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).endsWith('/auth/refresh'),
    );
    // Three parallel 401s, one refresh — more would 401 on an already-rotated
    // token and log the user out right after a successful refresh.
    expect(refreshCalls).toHaveLength(1);
  });

  it('AC: a 401 from /auth/login is a credentials error, not an expired session', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid credentials' }));

    await expect(apiClient.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toThrow(
      'Invalid credentials',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('AC: a signed-in user submitting a bad 2FA code is not logged out', async () => {
    // Regression guard: 2fa/verify legitimately 401s on a wrong code. Without
    // the no-refresh list, a stale session in localStorage would turn that
    // into a session-expired redirect and swallow the inline error.
    seedSession();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid code' }));

    await expect(
      apiClient.post('/auth/2fa/verify', { pendingTwoFactorToken: 'p', code: '000000' }),
    ).rejects.toThrow('Invalid code');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSession()).not.toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
