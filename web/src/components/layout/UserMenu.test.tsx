import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { setSession, getSession } from '@/lib/auth-store';
import { authApi } from '@/lib/auth-api';

vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api');
  return { ...actual, authApi: { ...actual.authApi, logout: vi.fn() } };
});

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-abc',
      user: {
        id: 'u1',
        email: 'qa@example.com',
        preferredLanguage: 'en',
        effectiveRole: 'PROPERTY_MANAGER',
        effectiveOutletIds: ['o1'],
      },
    });
  });

  it('AC: shows the real signed-in email and a human-readable role, not mock data', () => {
    renderMenu();
    expect(screen.getByText('qa@example.com')).toBeInTheDocument();
    expect(screen.getByText('Property Manager')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Al-Rashid')).not.toBeInTheDocument();
  });

  it('AC: Log out revokes the refresh token server-side and clears the local session', async () => {
    (authApi.logout as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    renderMenu();

    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByText('Log out'));

    await waitFor(() => expect(authApi.logout).toHaveBeenCalledWith('refresh-token-abc'));
    expect(getSession()).toBeNull();
  });

  it('still clears the local session even if the server-side revoke call fails (e.g. offline)', async () => {
    (authApi.logout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    renderMenu();

    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByText('Log out'));

    await waitFor(() => expect(getSession()).toBeNull());
  });
});
