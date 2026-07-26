import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PurchaseOrderForm } from './PurchaseOrderForm';
import { purchaseOrdersApi } from '@/lib/purchase-orders-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { itemsApi } from '@/lib/items-api';
import { taxRatesApi } from '@/lib/tax-rates-api';
import { currenciesApi } from '@/lib/currencies-api';
import { outletsApi } from '@/lib/outlets-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/purchase-orders-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/purchase-orders-api')>('@/lib/purchase-orders-api');
  return { ...actual, purchaseOrdersApi: { ...actual.purchaseOrdersApi, get: vi.fn(), create: vi.fn() } };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, list: vi.fn() } };
});
vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return { ...actual, itemsApi: { ...actual.itemsApi, list: vi.fn() } };
});
vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return { ...actual, taxRatesApi: { ...actual.taxRatesApi, list: vi.fn() } };
});
vi.mock('@/lib/currencies-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/currencies-api')>('@/lib/currencies-api');
  return { ...actual, currenciesApi: { ...actual.currenciesApi, list: vi.fn() } };
});
vi.mock('@/lib/outlets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/outlets-api')>('@/lib/outlets-api');
  return { ...actual, outletsApi: { ...actual.outletsApi, getCurrencySettings: vi.fn() } };
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/purchase-orders/new']}>
      <Routes>
        <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The Net/Tax/Discount/Other Charges/Gross summary box — scoped separately
// from the Discount/Other Charges *input fields* above it, since both use
// the same label text ("Discount"/"Other Charges").
function summaryBox() {
  return screen.getByText('Gross').closest('div')!.parentElement as HTMLElement;
}

describe('PurchaseOrderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 's1', name: 'Al-Fahad Trading' }]);
    (itemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'i1', name: 'Basmati Rice', currentStock: '10.000', unit: 'KG' }]);
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (currenciesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 }]);
    (outletsApi.getCurrencySettings as ReturnType<typeof vi.fn>).mockResolvedValue({ baseCurrency: 'SAR', supportedCurrencies: ['SAR'] });
  });

  it('AC: Discount and Other Charges lines are hidden from the summary by default (both 0.00)', async () => {
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(within(summaryBox()).queryByText('Discount')).not.toBeInTheDocument();
    expect(within(summaryBox()).queryByText('Other Charges')).not.toBeInTheDocument();
  });

  it('AC: entering a Discount amount shows it as its own labeled summary line', async () => {
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    const discountInput = screen.getByLabelText('Discount');
    await userEvent.clear(discountInput);
    await userEvent.type(discountInput, '10');

    expect(await within(summaryBox()).findByText('Discount')).toBeInTheDocument();
    expect(within(summaryBox()).queryByText('Other Charges')).not.toBeInTheDocument();
  });

  it('AC: entering an Other Charges amount shows it as its own labeled summary line', async () => {
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    const otherChargesInput = screen.getByLabelText('Other Charges');
    await userEvent.clear(otherChargesInput);
    await userEvent.type(otherChargesInput, '25');

    expect(await within(summaryBox()).findByText('Other Charges')).toBeInTheDocument();
    expect(within(summaryBox()).queryByText('Discount')).not.toBeInTheDocument();
  });

  it('saves with discountAmount/otherChargesAmount as separate fields', async () => {
    (purchaseOrdersApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'po1' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 's1');
    await userEvent.clear(screen.getByLabelText('Discount'));
    await userEvent.type(screen.getByLabelText('Discount'), '10');
    await userEvent.clear(screen.getByLabelText('Other Charges'));
    await userEvent.type(screen.getByLabelText('Other Charges'), '25');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(purchaseOrdersApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ discountAmount: '10', otherChargesAmount: '25' }),
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith('/purchase-orders/po1');
  });
});
