import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ResetPassword } from './ResetPassword';
import { ForgotPassword } from './ForgotPassword';
import { authApi } from '@/lib/auth-api';
import { ApiError } from '@/lib/api-client';

vi.mock('@/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-api')>('@/lib/auth-api');
  return { ...actual, authApi: { resetPassword: vi.fn(), forgotPassword: vi.fn() } };
});

const mocked = authApi as unknown as {
  resetPassword: ReturnType<typeof vi.fn>;
  forgotPassword: ReturnType<typeof vi.fn>;
};

function renderReset(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

async function fillBoth(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.type(screen.getByLabelText('New password'), a);
  await user.type(screen.getByLabelText('Confirm new password'), b);
  await user.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: submits the token from the query string with the new password', async () => {
    const user = userEvent.setup();
    mocked.resetPassword.mockResolvedValue({ success: true });
    renderReset('?token=abc123');

    await fillBoth(user, 'NewPassw0rd!', 'NewPassw0rd!');

    await waitFor(() => expect(mocked.resetPassword).toHaveBeenCalledWith('abc123', 'NewPassw0rd!'));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');
  });

  it('AC: mismatched passwords are caught before any request is made', async () => {
    const user = userEvent.setup();
    renderReset('?token=abc123');

    await fillBoth(user, 'NewPassw0rd!', 'DifferentPass1');

    expect(await screen.findByRole('alert')).toHaveTextContent("Passwords don't match.");
    expect(mocked.resetPassword).not.toHaveBeenCalled();
  });

  it('AC: the 8-character minimum is enforced client-side too', async () => {
    const user = userEvent.setup();
    renderReset('?token=abc123');

    await fillBoth(user, 'short', 'short');

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters');
    expect(mocked.resetPassword).not.toHaveBeenCalled();
  });

  it('AC: an expired token tells the user to request a new link', async () => {
    const user = userEvent.setup();
    mocked.resetPassword.mockRejectedValue(new ApiError(400, 'Invalid or expired reset token'));
    renderReset('?token=stale');

    await fillBoth(user, 'NewPassw0rd!', 'NewPassw0rd!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });

  it('AC: arriving without a token explains the problem instead of erroring on submit', () => {
    renderReset('');

    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/i);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: the confirmation does not reveal whether the account exists', async () => {
    const user = userEvent.setup();
    mocked.forgotPassword.mockResolvedValue({ sent: true });
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(mocked.forgotPassword).toHaveBeenCalledWith('nobody@example.com'));
    // Mirrors AuthService.forgotPassword's deliberate non-enumeration.
    expect(await screen.findByRole('status')).toHaveTextContent(/If an account exists/i);
  });
});
