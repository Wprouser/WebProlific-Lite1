import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Suppliers } from './Suppliers';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { currenciesApi } from '@/lib/currencies-api';
import { outletsApi } from '@/lib/outlets-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, list: vi.fn(), deactivate: vi.fn() } };
});
vi.mock('@/lib/currencies-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/currencies-api')>('@/lib/currencies-api');
  return { ...actual, currenciesApi: { ...actual.currenciesApi, list: vi.fn() } };
});
vi.mock('@/lib/outlets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/outlets-api')>('@/lib/outlets-api');
  return { ...actual, outletsApi: { ...actual.outletsApi, getCurrencySettings: vi.fn() } };
});

const activeSupplier: ApiSupplier = {
  id: 's1',
  outletId: 'o1',
  supplierCode: 'SUP-001',
  name: 'Al-Fahad Trading',
  contactPerson: null,
  phone: '+966500000000',
  email: 'contact@alfahad.example',
  addressLine: null,
  city: null,
  stateOrProvince: 'Riyadh',
  countryCode: 'SA',
  postalCode: null,
  preferredCurrency: 'SAR',
  taxRegistrationType: 'VAT Reg. No.',
  taxRegistrationNumber: '300123456700003',
  paymentTerms: null,
  leadTimeDays: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankIfscOrSwift: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <Suppliers />
    </MemoryRouter>,
  );
}

function setRole(role: string) {
  setSession({
    accessToken: 'token',
    refreshToken: 'refresh-token',
    user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: role, effectiveOutletIds: ['o1'] },
  });
}

describe('Suppliers screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (currenciesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
    ]);
    (outletsApi.getCurrencySettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      baseCurrency: 'SAR',
      supportedCurrencies: ['SAR', 'USD'],
    });
    setRole('PROPERTY_MANAGER');
  });

  it('AC: lists suppliers with name, code, contact, preferred currency, and tax registration', async () => {
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeSupplier]);
    renderScreen();

    // ResponsiveTable renders both a <table> and a stacked-card layout
    // simultaneously (CSS picks the visible one per viewport), so every
    // value appears twice in the DOM — getAllByText, not getByText.
    expect((await screen.findAllByText('Al-Fahad Trading')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('SUP-001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+966500000000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SAR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VAT Reg. No.: 300123456700003').length).toBeGreaterThan(0);
  });

  it('AC: a supplier with no tax registration shows a plain dash, not an error', async () => {
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...activeSupplier, taxRegistrationType: null, taxRegistrationNumber: null },
    ]);
    renderScreen();
    await screen.findAllByText('Al-Fahad Trading');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  describe('RBAC gating', () => {
    it('AC: OUTLET_MANAGER (broader role than Tax/Currency) can Add/Edit/Deactivate', async () => {
      setRole('OUTLET_MANAGER');
      (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeSupplier]);
      renderScreen();
      await screen.findAllByText('Al-Fahad Trading');

      expect(screen.getAllByRole('button', { name: 'Add supplier' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: 'Deactivate' }).length).toBeGreaterThan(0);
    });

    it('AC: STORE_STAFF sees no Add/Edit/Deactivate actions, only the read-only PO preview', async () => {
      setRole('STORE_STAFF');
      (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeSupplier]);
      renderScreen();
      await screen.findAllByText('Al-Fahad Trading');

      expect(screen.queryByRole('button', { name: 'Add supplier' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New Purchase Order' })).toBeInTheDocument();
    });
  });

  it('AC: deactivating shows a confirmation before calling the API', async () => {
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeSupplier]);
    (suppliersApi.deactivate as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeSupplier, isActive: false });
    renderScreen();
    await screen.findAllByText('Al-Fahad Trading');

    const deactivateButtons = screen.getAllByRole('button', { name: 'Deactivate' });
    await userEvent.click(deactivateButtons[0]!);
    expect(screen.getByText(/Deactivate "Al-Fahad Trading"\?/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(suppliersApi.deactivate).toHaveBeenCalledWith('s1'));
  });

  it('shows an empty state with an Add action when there are no suppliers yet', async () => {
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No suppliers yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add supplier' }).length).toBeGreaterThan(0);
  });
});
