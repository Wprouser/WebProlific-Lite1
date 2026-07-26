import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TaxRates } from './TaxRates';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return {
    ...actual,
    taxRatesApi: { ...actual.taxRatesApi, list: vi.fn(), deactivate: vi.fn(), preview: vi.fn() },
  };
});

const activeRate: ApiTaxRate = {
  id: 't1',
  outletId: 'o1',
  name: 'VAT 15%',
  ratePercent: '15.00',
  isCompound: false,
  isDefault: false,
  isActive: true,
  countryCode: 'SA',
  components: [],
};
const inactiveRate: ApiTaxRate = {
  id: 't2',
  outletId: 'o1',
  name: 'Old Rate',
  ratePercent: '5.00',
  isCompound: false,
  isDefault: false,
  isActive: false,
  countryCode: null,
  components: [],
};
const compoundRate: ApiTaxRate = {
  id: 't3',
  outletId: 'o1',
  name: 'GST 18% (Intra-state)',
  ratePercent: '18.00',
  isCompound: true,
  isDefault: false,
  isActive: true,
  countryCode: 'IN',
  components: [
    { id: 'c1', taxRateId: 't3', componentName: 'CGST', componentRate: '9.00' },
    { id: 'c2', taxRateId: 't3', componentName: 'SGST', componentRate: '9.00' },
  ],
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <TaxRates />
    </MemoryRouter>,
  );
}

describe('TaxRates screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'PROPERTY_MANAGER', effectiveOutletIds: ['o1'] },
    });
  });

  it('AC: lists tax rates with name, rate %, and active/inactive status', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate, inactiveRate]);
    renderScreen();

    // ResponsiveTable renders a <table> AND a stacked-card layout
    // simultaneously (CSS picks the visible one per viewport), so every
    // value appears twice in the DOM — getAllByText, not getByText.
    expect((await screen.findAllByText('VAT 15%')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('15.00%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('fetches without an isActive filter — this screen shows both active and inactive rows', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate]);
    renderScreen();
    await screen.findAllByText('VAT 15%');
    expect(taxRatesApi.list).toHaveBeenCalledWith();
  });

  it('AC: deactivating shows a plain confirmation when other active rates remain', async () => {
    const secondActive = { ...activeRate, id: 't3', name: 'Zero-Rated' };
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate, secondActive]);
    (taxRatesApi.deactivate as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeRate, isActive: false });
    renderScreen();
    await screen.findAllByText('VAT 15%');

    const deactivateButtons = screen.getAllByRole('button', { name: 'Deactivate' });
    await userEvent.click(deactivateButtons[0]!);

    expect(screen.getByText(/Deactivate "VAT 15%"\? It will no longer appear/)).toBeInTheDocument();
    expect(screen.queryByText(/is the last active tax rate/)).not.toBeInTheDocument();
  });

  it('AC: deactivating the last active rate shows the stronger last-active warning, not a hard block', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate, inactiveRate]);
    (taxRatesApi.deactivate as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeRate, isActive: false });
    renderScreen();
    await screen.findAllByText('VAT 15%');

    const deactivateButtons = screen.getAllByRole('button', { name: 'Deactivate' });
    await userEvent.click(deactivateButtons[0]!);

    expect(screen.getByText(/is the last active tax rate/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(taxRatesApi.deactivate).toHaveBeenCalledWith('t1'));
  });

  it('inactive rows have no Deactivate action (only Edit)', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([inactiveRate]);
    renderScreen();
    await screen.findAllByText('Old Rate');

    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
  });

  it('Add tax rate opens the create form', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();
    await screen.findByText('No tax rates yet');

    await userEvent.click(screen.getAllByRole('button', { name: 'Add tax rate' })[0]!);

    expect(screen.getByPlaceholderText('e.g. VAT 15%')).toBeInTheDocument();
  });

  it('AC: shows a Type badge — "Simple" for a flat rate, "Split" for a compound one', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate, compoundRate]);
    renderScreen();
    await screen.findAllByText('VAT 15%');

    expect(screen.getAllByText('Simple').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Split').length).toBeGreaterThan(0);
  });

  it('AC: Preview opens a calculation modal for that rate, without mutating anything', async () => {
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([compoundRate]);
    (taxRatesApi.preview as ReturnType<typeof vi.fn>).mockResolvedValue({
      lineSubtotal: '200.00',
      lineTaxAmount: '36.00',
      lineTotal: '236.00',
      components: [
        { componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' },
        { componentName: 'SGST', componentRate: '9.00', componentAmount: '18.00' },
      ],
    });
    renderScreen();
    await screen.findAllByText('GST 18% (Intra-state)');

    await userEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]!);
    expect(screen.getByText('Preview: GST 18% (Intra-state)')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('spinbutton'), '200');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    expect(await screen.findByText('CGST 9.00%: 18.00')).toBeInTheDocument();
    expect(screen.getByText('SGST 9.00%: 18.00')).toBeInTheDocument();
    expect(taxRatesApi.deactivate).not.toHaveBeenCalled();
  });

  describe('RBAC gating for a role that cannot mutate tax rates', () => {
    beforeEach(() => {
      setSession({
        accessToken: 'token',
        refreshToken: 'refresh-token',
        user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
      });
    });

    it('AC: hides "Add tax rate" entirely rather than letting the user attempt and fail', async () => {
      (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate]);
      renderScreen();
      await screen.findAllByText('VAT 15%');

      expect(screen.queryByRole('button', { name: 'Add tax rate' })).not.toBeInTheDocument();
    });

    it('AC: hides Edit and Deactivate row actions, but keeps the read-only Preview action', async () => {
      (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate]);
      renderScreen();
      await screen.findAllByText('VAT 15%');

      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Preview' }).length).toBeGreaterThan(0);
    });

    it('the empty state does not offer an Add action either', async () => {
      (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      renderScreen();
      await screen.findByText('No tax rates yet');

      expect(screen.queryByRole('button', { name: 'Add tax rate' })).not.toBeInTheDocument();
    });
  });

  it('AC: CHAIN_OWNER (the other mutate-capable role) still sees Add/Edit/Deactivate', async () => {
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'CHAIN_OWNER', effectiveOutletIds: ['o1'] },
    });
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([activeRate]);
    renderScreen();
    await screen.findAllByText('VAT 15%');

    expect(screen.getAllByRole('button', { name: 'Add tax rate' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Deactivate' }).length).toBeGreaterThan(0);
  });
});
