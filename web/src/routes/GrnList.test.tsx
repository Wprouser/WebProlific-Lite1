import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { GrnList } from './GrnList';
import { grnApi, type ApiGrn } from '@/lib/grn-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/grn-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/grn-api')>('@/lib/grn-api');
  return { ...actual, grnApi: { ...actual.grnApi, list: vi.fn() } };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, list: vi.fn() } };
});

const sampleGrn: ApiGrn = {
  id: 'g1',
  outletId: 'o1',
  purchaseOrderId: null,
  supplierId: 's1',
  receivedById: 'u1',
  receivedAt: '2026-01-01T00:00:00.000Z',
  currencyCode: 'SAR',
  exchangeRateToBase: '1',
  isTaxInclusive: false,
  discountAmount: '0.00',
  otherChargesAmount: '0.00',
  subtotal: '460.00',
  taxAmount: '69.00',
  totalValue: '529.00',
  invoiceNumber: null,
  invoiceScanUrl: null,
  invoiceScanStatus: null,
  varianceFlagged: false,
  lines: [],
  lastEmailedAt: null,
  lastEmailedTo: null,
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <GrnList />
    </MemoryRouter>,
  );
}

describe('GrnList screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 's1', name: 'Al-Fahad Trading' }]);
  });

  it('lists GRNs with supplier name, source badge, and total', async () => {
    (grnApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sampleGrn]);
    renderScreen();

    expect(await screen.findByRole('cell', { name: 'Al-Fahad Trading' })).toBeInTheDocument();
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'SAR 529.00' })).toBeInTheDocument();
  });

  it('shows an "Against PO" badge and a variance badge when applicable', async () => {
    (grnApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...sampleGrn, purchaseOrderId: 'po1', varianceFlagged: true },
    ]);
    renderScreen();

    await screen.findByRole('cell', { name: 'Al-Fahad Trading' });
    expect(screen.getByText('Against PO')).toBeInTheDocument();
    expect(screen.getByText('Variance')).toBeInTheDocument();
  });

  it('navigates to the detail screen when a row is clicked', async () => {
    (grnApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sampleGrn]);
    renderScreen();

    const cell = await screen.findByRole('cell', { name: 'Al-Fahad Trading' });
    await userEvent.click(cell.closest('tr')!);
    expect(navigateMock).toHaveBeenCalledWith('/grn/g1');
  });

  it('shows an empty state with a New GRN action when there are none', async () => {
    (grnApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No GRNs yet')).toBeInTheDocument();
  });

  it('navigates to the New GRN chooser from the header action', async () => {
    (grnApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sampleGrn]);
    renderScreen();
    await screen.findByRole('cell', { name: 'Al-Fahad Trading' });

    await userEvent.click(screen.getByRole('button', { name: 'New GRN' }));
    expect(navigateMock).toHaveBeenCalledWith('/grn/new');
  });
});
