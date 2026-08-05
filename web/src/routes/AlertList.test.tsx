import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertList } from './AlertList';
import { alertsApi, type ApiAlert } from '@/lib/alerts-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/alerts-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/alerts-api')>('@/lib/alerts-api');
  return {
    ...actual,
    alertsApi: {
      ...actual.alertsApi,
      list: vi.fn(),
      acknowledge: vi.fn(),
      resolve: vi.fn(),
      createPoDraft: vi.fn(),
    },
  };
});

function alert(overrides: Partial<ApiAlert> = {}): ApiAlert {
  return {
    id: 'a1',
    outletId: 'o1',
    itemId: 'i1',
    itemName: 'Basmati Rice',
    type: 'LOW_STOCK',
    status: 'OPEN',
    message: 'Basmati Rice is at or below its minimum stock level — 5.000 on hand, minimum 10.000.',
    createdAt: '2026-08-05T10:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function renderScreen(type = 'low-stock') {
  return render(
    <MemoryRouter initialEntries={[`/alerts/${type}`]}>
      <Routes>
        <Route path="/alerts/:type" element={<AlertList />} />
      </Routes>
    </MemoryRouter>,
  );
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('AlertList screen', () => {
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
    asMock(alertsApi.list).mockResolvedValue([alert()]);
  });

  it('lists real alerts with their message, type and status', async () => {
    renderScreen();

    expect(await screen.findByText(/Basmati Rice is at or below/)).toBeInTheDocument();
    expect(screen.getByText('Low stock')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows both stock types under the one low-stock badge', async () => {
    // The bar has a single "Low-Stock Items" badge, but the API filters on a
    // single type — so this route asks broadly and narrows client-side.
    asMock(alertsApi.list).mockResolvedValue([
      alert({ id: 'a1', type: 'LOW_STOCK' }),
      alert({ id: 'a2', type: 'OUT_OF_STOCK', message: 'Rice is out of stock (0.000 on hand).' }),
      alert({ id: 'a3', type: 'EXPIRY_WARNING', message: 'Cream expires soon.' }),
    ]);
    renderScreen('low-stock');

    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.queryByText('Expiring')).not.toBeInTheDocument();
  });

  it('filters by status rather than type on the unacknowledged route', async () => {
    renderScreen('unacknowledged');
    await screen.findByText(/Basmati Rice is at or below/);

    expect(alertsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN', type: undefined }),
    );
  });

  it('asks the API for a single type on the expiry route', async () => {
    renderScreen('expiry');
    await waitFor(() =>
      expect(alertsApi.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXPIRY_WARNING' })),
    );
  });

  it('acknowledges an alert and reloads', async () => {
    asMock(alertsApi.acknowledge).mockResolvedValue(alert({ status: 'ACKNOWLEDGED' }));
    renderScreen();
    await screen.findByText(/Basmati Rice is at or below/);

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(alertsApi.acknowledge).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(alertsApi.list).toHaveBeenCalledTimes(2));
  });

  it('AC: offers the create-PO shortcut and opens the draft it creates', async () => {
    asMock(alertsApi.createPoDraft).mockResolvedValue({ id: 'po-9' });
    renderScreen();
    await screen.findByText(/Basmati Rice is at or below/);

    await userEvent.click(screen.getByRole('button', { name: 'Create PO draft' }));

    expect(alertsApi.createPoDraft).toHaveBeenCalledWith('a1');
    expect(navigateMock).toHaveBeenCalledWith('/purchase-orders/po-9');
  });

  it('does not offer a PO for an expiry alert — reordering does not fix spoilage', async () => {
    asMock(alertsApi.list).mockResolvedValue([alert({ type: 'EXPIRY_WARNING' })]);
    renderScreen('expiry');
    await screen.findByText('Expiring');

    expect(screen.queryByRole('button', { name: 'Create PO draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('offers no actions on an already-resolved alert', async () => {
    asMock(alertsApi.list).mockResolvedValue([alert({ status: 'RESOLVED' })]);
    renderScreen();
    await screen.findByText('Resolved');

    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('surfaces the server\'s reason when the PO shortcut is refused', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    asMock(alertsApi.createPoDraft).mockRejectedValue(
      new ApiError(400, '"Basmati Rice" has no default supplier, so a purchase order can\'t be pre-filled.'),
    );
    renderScreen();
    await screen.findByText(/Basmati Rice is at or below/);

    await userEvent.click(screen.getByRole('button', { name: 'Create PO draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no default supplier');
  });

  it('redirects the PO-approvals badge to the purchase orders screen', async () => {
    // That badge counts FR-04 documents, not FR-07 alerts — an empty alert
    // table there would look like a bug.
    renderScreen('po-approvals');
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/purchase-orders', { replace: true }),
    );
    expect(alertsApi.list).not.toHaveBeenCalled();
  });

  it('redirects the GRN-variance badge to the GRN screen', async () => {
    renderScreen('grn-variance');
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/grn', { replace: true }));
  });

  it('shows an empty state when nothing needs attention', async () => {
    asMock(alertsApi.list).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
  });
});
