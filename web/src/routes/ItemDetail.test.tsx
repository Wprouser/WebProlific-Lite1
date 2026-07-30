import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ItemDetail } from './ItemDetail';
import { itemsApi, categoriesApi, itemImagesApi, unitsApi, type ApiItem } from '@/lib/items-api';
import { stockTransactionsApi } from '@/lib/stock-transactions-api';
import { transactionLogApi } from '@/lib/transaction-log-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, get: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn(), clone: vi.fn() },
    categoriesApi: { ...actual.categoriesApi, list: vi.fn() },
    itemImagesApi: { ...actual.itemImagesApi, list: vi.fn() },
    unitsApi: { ...actual.unitsApi, list: vi.fn() },
  };
});

vi.mock('@/lib/stock-transactions-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stock-transactions-api')>(
    '@/lib/stock-transactions-api',
  );
  return { ...actual, stockTransactionsApi: { ...actual.stockTransactionsApi, list: vi.fn() } };
});

vi.mock('@/lib/transaction-log-api', () => ({
  transactionLogApi: { listForEntity: vi.fn() },
}));

const item: ApiItem = {
  id: 'i1',
  outletId: 'o1',
  name: 'Basmati Rice',
  categoryId: 'c1',
  sku: 'RICE-BAS-001',
  barcode: null,
  unitId: 'u1',
  minStock: '10',
  maxStock: '100',
  currentStock: '25.000',
  shelfLifeDays: 365,
  costPrice: '85.50',
  defaultSupplierId: null,
  purchaseGLAccount: null,
  defaultTaxRateId: null,
  storageLocation: 'Dry Store',
  isActive: true,
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/items/i1']}>
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ItemDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (itemsApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (categoriesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'c1', name: 'Dry Goods', outletId: 'o1' }]);
    (unitsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'u1', outletId: 'o1', name: 'Kilogram', abbreviation: 'kg', baseUnitId: null, conversionFactor: null, isActive: true },
    ]);
    (itemImagesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (stockTransactionsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 't1',
        outletId: 'o1',
        itemId: 'i1',
        type: 'OPENING_BALANCE',
        quantity: '25.000',
        balanceAfter: '25.000',
        referenceType: 'MANUAL',
        referenceId: null,
        reasonCode: null,
        photoUrl: null,
        performedById: 'u1',
        createdAt: new Date().toISOString(),
      },
    ]);
    (transactionLogApi.listForEntity as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('loads and renders the item name, SKU, and stock summary panel', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Basmati Rice' })).toBeInTheDocument();
    expect(screen.getByText('RICE-BAS-001')).toBeInTheDocument();
    // Stock value = currentStock (25) * costPrice (85.50) = 2137.50
    expect(screen.getByText('2137.50')).toBeInTheDocument();
    // Opening stock surfaced from the OPENING_BALANCE transaction row.
    expect(screen.getByText(/25\.000 kg @ 85\.50/)).toBeInTheDocument();
  });

  it('switches to the Transactions tab and shows the OPENING_BALANCE row', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    await userEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    expect(screen.getAllByText('+25.000').length).toBeGreaterThan(0);
  });

  it('Adjust Stock opens the stock transaction form pre-scoped to this item', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    await userEvent.click(screen.getByRole('button', { name: /Adjust stock/i }));

    expect(await screen.findByText('Record stock transaction')).toBeInTheDocument();
    // Only this item is offered — the form is scoped to the current item, not a global picker.
    expect(screen.getAllByText('Basmati Rice (RICE-BAS-001)').length).toBeGreaterThan(0);
  });

  it('the More menu opens the clone dialog', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByText('Clone item'));

    expect(await screen.findByText('Clone item', { selector: 'h2, [class*="Title"], *' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. RICE-BAS-002')).toBeInTheDocument();
  });

  it('shows a restricted message on the History tab when the API returns 403', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (transactionLogApi.listForEntity as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'Forbidden'),
    );
    renderDetail();
    await screen.findByRole('heading', { name: 'Basmati Rice' });

    await userEvent.click(screen.getByRole('button', { name: 'History' }));

    await waitFor(() => {
      expect(screen.getByText("You don't have permission to view this item's history")).toBeInTheDocument();
    });
  });
});
