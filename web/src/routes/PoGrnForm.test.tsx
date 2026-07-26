import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PoGrnForm } from './PoGrnForm';
import { purchaseOrdersApi, type ApiPurchaseOrder } from '@/lib/purchase-orders-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { itemsApi } from '@/lib/items-api';
import { taxRatesApi } from '@/lib/tax-rates-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/purchase-orders-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/purchase-orders-api')>('@/lib/purchase-orders-api');
  return { ...actual, purchaseOrdersApi: { ...actual.purchaseOrdersApi, get: vi.fn(), list: vi.fn() } };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, get: vi.fn(), list: vi.fn() } };
});
vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return { ...actual, itemsApi: { ...actual.itemsApi, list: vi.fn() } };
});
vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return { ...actual, taxRatesApi: { ...actual.taxRatesApi, list: vi.fn() } };
});

const supplier = { id: 's1', name: 'Al-Fahad Trading', email: 'supplier@example.com' };

const fixturePO: ApiPurchaseOrder = {
  id: 'po1',
  outletId: 'o1',
  supplierId: 's1',
  status: 'SENT_TO_SUPPLIER',
  expectedDeliveryDate: null,
  createdById: 'u1',
  approvedById: 'u1',
  approvedAt: '2026-01-01T00:00:00.000Z',
  currencyCode: 'SAR',
  exchangeRateToBase: '1',
  isTaxInclusive: false,
  discountAmount: '0.00',
  otherChargesAmount: '0.00',
  subtotal: '500.00',
  taxAmount: '0.00',
  totalValue: '500.00',
  lines: [
    {
      id: 'l1',
      purchaseOrderId: 'po1',
      itemId: 'i1',
      orderedQty: '5.000',
      expectedPrice: '100.00',
      taxRateId: null,
      taxRate: '0.00',
      lineSubtotal: '500.00',
      lineTaxAmount: '0.00',
      lineTotal: '500.00',
      receivedQty: '0.000',
      taxComponents: [],
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastEmailedAt: null,
  lastEmailedTo: null,
};

function renderScreen(poId?: string) {
  const entry = poId ? `/grn/new/po/${poId}` : '/grn/new/po';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/grn/new/po" element={<PoGrnForm />} />
        <Route path="/grn/new/po/:poId" element={<PoGrnForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PoGrnForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (itemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'i1', name: 'Basmati Rice', unit: 'KG', currentStock: '10' }]);
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('AC (regression): landing directly with a pre-selected poId resolves and displays the real supplier name, not its id', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(fixturePO);
    (suppliersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(supplier);
    renderScreen('po1');

    expect(await screen.findByText('Al-Fahad Trading')).toBeInTheDocument();
    expect(suppliersApi.get).toHaveBeenCalledWith('s1');
    expect(screen.queryByText('s1')).not.toBeInTheDocument();
  });

  it('pre-populates lines from the PO with a remaining-quantity default for receivedQty', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(fixturePO);
    (suppliersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(supplier);
    renderScreen('po1');

    await screen.findByText('Al-Fahad Trading');
    expect(screen.getByText('Basmati Rice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5.000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100.00')).toBeInTheDocument();
  });

  it('shows the receivable-PO picker when no poId is given', async () => {
    (purchaseOrdersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([fixturePO]);
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([supplier]);
    renderScreen();

    expect(await screen.findByText('Al-Fahad Trading')).toBeInTheDocument();
    expect(screen.getByText('Choose a Purchase Order')).toBeInTheDocument();
  });

  it('shows an error for a PO that is no longer receivable', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...fixturePO, status: 'DRAFT' });
    renderScreen('po1');

    expect(await screen.findByText("This purchase order can no longer be received against.")).toBeInTheDocument();
  });
});
