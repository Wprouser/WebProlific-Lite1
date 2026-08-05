import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AlertBar } from './AlertBar';
import { alertsApi, type ApiAlertSummary } from '@/lib/alerts-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/alerts-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/alerts-api')>('@/lib/alerts-api');
  return { ...actual, alertsApi: { ...actual.alertsApi, summary: vi.fn() } };
});

function summary(overrides: Partial<ApiAlertSummary> = {}): ApiAlertSummary {
  return { lowStock: 0, expiry: 0, unacknowledged: 0, poApprovals: 0, grnVariance: 0, ...overrides };
}

function renderBar() {
  return render(
    <MemoryRouter>
      <AlertBar />
    </MemoryRouter>,
  );
}

describe('AlertBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: {
        id: 'u1',
        email: 'test@example.com',
        preferredLanguage: 'en',
        effectiveRole: 'OUTLET_MANAGER',
        effectiveOutletIds: ['o1'],
      },
    });
  });

  it('shows real counts from the summary endpoint, scoped to the outlet', async () => {
    (alertsApi.summary as ReturnType<typeof vi.fn>).mockResolvedValue(
      summary({ lowStock: 3, expiry: 2 }),
    );
    renderBar();

    const lowStock = await screen.findByRole('link', { name: /Low-Stock Items/ });
    expect(lowStock).toHaveTextContent('3');
    expect(lowStock).toHaveAttribute('href', '/alerts/low-stock');
    expect(screen.getByRole('link', { name: /Expiry Warnings/ })).toHaveTextContent('2');
    expect(alertsApi.summary).toHaveBeenCalledWith('o1');
  });

  it('shows the FR-04 badges too — they were never FR-07 alerts but are on the same bar', async () => {
    (alertsApi.summary as ReturnType<typeof vi.fn>).mockResolvedValue(
      summary({ poApprovals: 4, grnVariance: 1 }),
    );
    renderBar();

    expect(await screen.findByRole('link', { name: /Pending PO Approvals/ })).toHaveTextContent('4');
    expect(screen.getByRole('link', { name: /GRN Variance/ })).toHaveAttribute('href', '/alerts/grn-variance');
  });

  it('hides a badge at zero rather than showing a permanent "0"', async () => {
    (alertsApi.summary as ReturnType<typeof vi.fn>).mockResolvedValue(summary({ lowStock: 1 }));
    renderBar();

    await screen.findByRole('link', { name: /Low-Stock Items/ });
    expect(screen.queryByRole('link', { name: /Expiry Warnings/ })).not.toBeInTheDocument();
  });

  it('says so when nothing needs attention', async () => {
    (alertsApi.summary as ReturnType<typeof vi.fn>).mockResolvedValue(summary());
    renderBar();
    expect(await screen.findAllByText('No alerts right now')).not.toHaveLength(0);
  });

  it('stays quiet rather than breaking the chrome when the count fails to load', async () => {
    // This bar wraps every screen in the app; a failed request here must not
    // take the whole layout down.
    (alertsApi.summary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    renderBar();
    expect(await screen.findAllByText('No alerts right now')).not.toHaveLength(0);
  });
});
