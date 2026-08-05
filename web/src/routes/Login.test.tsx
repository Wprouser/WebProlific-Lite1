import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { authApi, type LoginSuccessResponse } from '@/lib/auth-api';
import { ApiError } from '@/lib/api-client';
import { getSession, getTrustedDeviceToken, markSessionExpired } from '@/lib/auth-store';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api');
  return {
    ...actual,
    authApi: {
      login: vi.fn(),
      verifyTwoFactor: vi.fn(),
      loginWithBackupCode: vi.fn(),
      resendTwoFactor: vi.fn(),
      me: vi.fn(),
    },
  };
});

const mocked = authApi as unknown as {
  login: ReturnType<typeof vi.fn>;
  verifyTwoFactor: ReturnType<typeof vi.fn>;
  loginWithBackupCode: ReturnType<typeof vi.fn>;
  resendTwoFactor: ReturnType<typeof vi.fn>;
  me: ReturnType<typeof vi.fn>;
};

const success: LoginSuccessResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
  user: {
    id: 'u1',
    preferredLanguage: 'en',
    effectiveRole: 'CHAIN_OWNER',
    effectiveOutletIds: ['o1'],
  },
};

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

async function submitCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'owner@example.com');
  await user.type(screen.getByLabelText('Password'), 'hunter2222');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocked.me.mockResolvedValue({ email: 'owner@example.com' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC: signs in against the real endpoint and stores the returned tokens', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue(success);
    renderLogin();

    await submitCredentials(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(mocked.login).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'hunter2222',
    });
    const session = getSession();
    expect(session?.accessToken).toBe('access-1');
    // Not discarded — the silent-refresh path depends on it.
    expect(session?.refreshToken).toBe('refresh-1');
    expect(session?.user.email).toBe('owner@example.com');
  });

  it('AC: a 401 renders inline and does not create a session', async () => {
    const user = userEvent.setup();
    mocked.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    renderLogin();

    await submitCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(getSession()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('AC: rate-limited login (429) is distinguished from bad credentials', async () => {
    const user = userEvent.setup();
    mocked.login.mockRejectedValue(new ApiError(429, 'Too Many Requests'));
    renderLogin();

    await submitCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.');
  });

  it('AC: requiresTwoFactor advances to the challenge step without issuing a session', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactor: true,
      pendingTwoFactorToken: 'pending-1',
      method: 'EMAIL',
      maskedDestination: 'o**@example.com',
    });
    renderLogin();

    await submitCredentials(user);

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByText(/o\*\*@example\.com/)).toBeInTheDocument();
    // Spec: "Do not issue access/refresh tokens at this stage."
    expect(getSession()).toBeNull();
  });

  it('AC: verifies the code and persists the trusted-device token when asked to', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactor: true,
      pendingTwoFactorToken: 'pending-1',
      method: 'EMAIL',
      maskedDestination: null,
    });
    mocked.verifyTwoFactor.mockResolvedValue({ ...success, trustedDeviceToken: 'trusted-1' });
    renderLogin();

    await submitCredentials(user);
    await user.type(await screen.findByLabelText('Verification code'), '482913');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(mocked.verifyTwoFactor).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingTwoFactorToken: 'pending-1',
        code: '482913',
        trustDevice: true,
      }),
    );
    expect(getTrustedDeviceToken()).toBe('trusted-1');
  });

  it('AC: a stored trusted-device token is presented on the next login', async () => {
    localStorage.setItem('webprolific.trustedDevice', 'trusted-1');
    const user = userEvent.setup();
    mocked.login.mockResolvedValue(success);
    renderLogin();

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocked.login).toHaveBeenCalledWith(
        expect.objectContaining({ trustedDeviceToken: 'trusted-1' }),
      ),
    );
  });

  it('AC: the backup-code toggle submits to the backup-code endpoint', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactor: true,
      pendingTwoFactorToken: 'pending-1',
      method: 'TOTP',
      maskedDestination: null,
    });
    mocked.loginWithBackupCode.mockResolvedValue(success);
    renderLogin();

    await submitCredentials(user);
    await user.click(await screen.findByRole('button', { name: 'Use a backup code instead' }));
    await user.type(screen.getByLabelText('Backup code'), 'EDWJF6JNUU');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mocked.loginWithBackupCode).toHaveBeenCalledWith(
        expect.objectContaining({ backupCode: 'EDWJF6JNUU' }),
      ),
    );
    expect(mocked.verifyTwoFactor).not.toHaveBeenCalled();
  });

  it('AC: resend is offered for EMAIL but never for TOTP', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactor: true,
      pendingTwoFactorToken: 'pending-1',
      method: 'TOTP',
      maskedDestination: null,
    });
    renderLogin();

    await submitCredentials(user);
    await screen.findByLabelText('Verification code');

    // The backend rejects resend for TOTP outright, so it must not be offered.
    expect(screen.queryByRole('button', { name: /Resend code/ })).not.toBeInTheDocument();
  });

  it('AC: resend starts on cooldown for EMAIL, since login already sent a code', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactor: true,
      pendingTwoFactorToken: 'pending-1',
      method: 'EMAIL',
      maskedDestination: 'o**@example.com',
    });
    renderLogin();

    await submitCredentials(user);

    const resend = await screen.findByRole('button', { name: /Resend code in \d+s/ });
    expect(resend).toBeDisabled();
  });

  it('AC: a failed silent refresh surfaces "session expired" on arrival', async () => {
    markSessionExpired();
    // StrictMode deliberately: it double-invokes the mount effect, and the
    // flag is one-shot — a naive `setExpired(consume())` reads false on the
    // second pass and hides the banner. main.tsx renders under StrictMode, so
    // testing without it would miss that entirely.
    render(
      <StrictMode>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Your session expired.');
    expect(sessionStorage.getItem('webprolific.sessionExpired')).toBeNull();
  });

  it('AC: forced-enrollment accounts get an explanation rather than a silent no-op', async () => {
    const user = userEvent.setup();
    mocked.login.mockResolvedValue({
      requiresTwoFactorEnrollment: true,
      pendingEnrollmentToken: 'enroll-1',
    });
    renderLogin();

    await submitCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor authentication setup/i);
    expect(getSession()).toBeNull();
  });

  it('AC: the pre-auth language switcher still translates this screen (FR-15)', async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /language/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'العربية' }));

    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });
});
