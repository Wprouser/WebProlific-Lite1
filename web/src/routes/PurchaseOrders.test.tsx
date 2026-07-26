import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseOrders } from './PurchaseOrders';
import { purchaseOrdersApi, type ApiPurchaseOrder } from '@/lib/purchase-orders-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/purchase-orders-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/purchase-orders-api')>('@/lib/purchase-orders-api');
  return { ...actual, purchaseOrdersApi: { ...actual.purchaseOrdersApi, list: vi.fn() } };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, list: vi.fn() } };
});

const samplePO: ApiPurchaseOrder = {
  id: 'po1',
  outletId: 'o1',
  supplierId: 's1',
  status: 'DRAFT',
  expectedDeliveryDate: null,
  createdById: 'u1',
  approvedById: null,
  approvedAt: null,
  currencyCode: 'SAR',
  exchangeRateToBase: '1',
  isTaxInclusive: false,
  discountAmount: '0.00',
  otherChargesAmount: '0.00',
  subtotal: '100.00',
  taxAmount: '15.00',
  totalValue: '115.00',
  lines: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastEmailedAt: null,
  lastEmailedTo: null,
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <PurchaseOrders />
    </MemoryRouter>,
  );
}

describe('PurchaseOrders list screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', name: 'Al-Fahad Trading' },
    ]);
  });

  it('lists purchase orders with supplier name, status, and total', async () => {
    (purchaseOrdersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([samplePO]);
    renderScreen();

    expect(await screen.findByRole('cell', { name: 'Al-Fahad Trading' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'SAR 115.00' })).toBeInTheDocument();
  });

  it('navigates to the detail screen when a row is clicked', async () => {
    (purchaseOrdersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([samplePO]);
    renderScreen();

    const cell = await screen.findByRole('cell', { name: 'Al-Fahad Trading' });
    await userEvent.click(cell.closest('tr')!);
    expect(navigateMock).toHaveBeenCalledWith('/purchase-orders/po1');
  });

  it('shows an empty state with a New Purchase Order action when there are none', async () => {
    (purchaseOrdersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();

    expect(await screen.findByText('No purchase orders yet')).toBeInTheDocument();
  });

  it('navigates to the create screen from the header action', async () => {
    (purchaseOrdersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([samplePO]);
    renderScreen();
    await screen.findByRole('cell', { name: 'Al-Fahad Trading' });

    await userEvent.click(screen.getByRole('button', { name: 'New Purchase Order' }));
    expect(navigateMock).toHaveBeenCalledWith('/purchase-orders/new');
  });
});
