import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaxRateFormModal } from './TaxRateFormModal';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';

vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return {
    ...actual,
    taxRatesApi: { ...actual.taxRatesApi, create: vi.fn(), update: vi.fn() },
  };
});

const existingRate: ApiTaxRate = {
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

const existingCompoundRate: ApiTaxRate = {
  id: 't2',
  outletId: 'o1',
  name: 'GST 18% (Intra-state)',
  ratePercent: '18.00',
  isCompound: true,
  isDefault: false,
  isActive: true,
  countryCode: 'IN',
  components: [
    { id: 'c1', taxRateId: 't2', componentName: 'CGST', componentRate: '9.00' },
    { id: 'c2', taxRateId: 't2', componentName: 'SGST', componentRate: '9.00' },
  ],
};

describe('TaxRateFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: creating a simple tax rate calls create with the outletId, name, and ratePercent', async () => {
    (taxRatesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRate, id: 'new' });
    const onSaved = vi.fn();

    render(
      <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={onSaved} />,
    );

    await userEvent.type(screen.getByPlaceholderText('e.g. VAT 15%'), 'GST 5%');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(taxRatesApi.create).toHaveBeenCalledWith({
      outletId: 'o1',
      name: 'GST 5%',
      ratePercent: '5',
      isCompound: false,
      countryCode: undefined,
      components: undefined,
    });
  });

  it('AC: editing pre-fills the existing name/rate and calls update, not create', async () => {
    (taxRatesApi.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRate, name: 'VAT 16%' });
    const onSaved = vi.fn();

    render(
      <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={existingRate} outletId="o1" onSaved={onSaved} />,
    );

    expect(screen.getByDisplayValue('VAT 15%')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15.00')).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText('e.g. VAT 15%'));
    await userEvent.type(screen.getByPlaceholderText('e.g. VAT 15%'), 'VAT 16%');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(taxRatesApi.update).toHaveBeenCalledWith('t1', {
      name: 'VAT 16%',
      ratePercent: '15.00',
      isCompound: false,
      countryCode: 'SA',
      components: undefined,
      isActive: true,
    });
    expect(taxRatesApi.create).not.toHaveBeenCalled();
  });

  it('shows the server error message when saving fails', async () => {
    // A value inside the input's own min/max (0-100) so jsdom's native HTML5
    // validation doesn't block the submit before this component's handler
    // (and the server-side rejection it's testing) ever runs.
    const { ApiError } = await import('@/lib/api-client');
    (taxRatesApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(409, 'A tax rate with this name already exists'),
    );

    render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText('e.g. VAT 15%'), 'VAT 15%');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A tax rate with this name already exists')).toBeInTheDocument();
  });

  it('AC: a 403 from the server shows a clean generic message, never the raw role/outlet-UUID string', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (taxRatesApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'Requires role [CHAIN_OWNER, PROPERTY_MANAGER] at outlet 9c1b2e3a-...'),
    );

    render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText('e.g. VAT 15%'), 'VAT 15%');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("You don't have permission to make this change.")).toBeInTheDocument();
    expect(screen.queryByText(/CHAIN_OWNER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/9c1b2e3a/)).not.toBeInTheDocument();
  });

  describe('compound tax mode', () => {
    it('AC: toggling "Compound tax?" on switches to a 2-row components list with a read-only auto-summed rate', async () => {
      render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />);

      await userEvent.click(screen.getByText('Compound tax?'));

      expect(screen.getAllByPlaceholderText('e.g. CGST')).toHaveLength(2);
      const overallRate = screen.getAllByLabelText('Rate (%)').at(-1) as HTMLInputElement;
      expect(overallRate).toBeDisabled();
      expect(overallRate.value).toBe('0.00');
    });

    it('AC: the read-only rate auto-sums as component rates are typed', async () => {
      render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />);
      await userEvent.click(screen.getByText('Compound tax?'));

      const nameInputs = screen.getAllByPlaceholderText('e.g. CGST');
      const rateInputs = screen.getAllByLabelText('Rate (%)');
      // rateInputs[0] is the per-component field for row 0 since the
      // overall auto-summed Rate (%) field is the last one rendered.
      await userEvent.type(nameInputs[0]!, 'CGST');
      await userEvent.type(rateInputs[0]!, '9');
      await userEvent.type(nameInputs[1]!, 'SGST');
      await userEvent.type(rateInputs[1]!, '9');

      const overallRate = screen.getAllByLabelText('Rate (%)').at(-1) as HTMLInputElement;
      expect(overallRate.value).toBe('18.00');
    });

    it('AC: Add component appends a row, and Remove is disabled once only one row remains', async () => {
      render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />);
      await userEvent.click(screen.getByText('Compound tax?'));

      await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
      expect(screen.getAllByPlaceholderText('e.g. CGST')).toHaveLength(3);

      const removeButtons = screen.getAllByRole('button', { name: 'Remove component' });
      await userEvent.click(removeButtons[0]!);
      await userEvent.click(screen.getAllByRole('button', { name: 'Remove component' })[0]!);
      expect(screen.getAllByPlaceholderText('e.g. CGST')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Remove component' })).toBeDisabled();
    });

    it('AC: creating a compound rate with a single component (e.g. IGST) is allowed, not blocked at 2 rows', async () => {
      (taxRatesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingCompoundRate, id: 'new' });
      const onSaved = vi.fn();
      render(<TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={onSaved} />);

      await userEvent.type(screen.getByPlaceholderText('e.g. VAT 15%'), 'GST 18% (Inter-state)');
      await userEvent.click(screen.getByText('Compound tax?'));
      await userEvent.click(screen.getAllByRole('button', { name: 'Remove component' })[0]!);

      const nameInputs = screen.getAllByPlaceholderText('e.g. CGST');
      const rateInputs = screen.getAllByLabelText('Rate (%)');
      await userEvent.type(nameInputs[0]!, 'IGST');
      await userEvent.type(rateInputs[0]!, '18');

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(taxRatesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isCompound: true,
          ratePercent: '18.00',
          components: [{ componentName: 'IGST', componentRate: '18' }],
        }),
      );
    });

    it('AC: editing an existing compound rate pre-fills its components and country', async () => {
      render(
        <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={existingCompoundRate} outletId="o1" onSaved={vi.fn()} />,
      );

      expect(screen.getByDisplayValue('CGST')).toBeInTheDocument();
      expect(screen.getByDisplayValue('SGST')).toBeInTheDocument();
      expect(screen.getByDisplayValue('India')).toBeInTheDocument();
      const overallRate = screen.getAllByLabelText('Rate (%)').at(-1) as HTMLInputElement;
      expect(overallRate.value).toBe('18.00');
    });
  });

  describe('active toggle', () => {
    it('is only shown when editing, not creating', () => {
      const { rerender } = render(
        <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={null} outletId="o1" onSaved={vi.fn()} />,
      );
      expect(screen.queryByText('Active')).not.toBeInTheDocument();

      rerender(
        <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={existingRate} outletId="o1" onSaved={vi.fn()} />,
      );
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('AC: unchecking Active and saving sends isActive: false', async () => {
      (taxRatesApi.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRate, isActive: false });
      const onSaved = vi.fn();
      render(
        <TaxRateFormModal open onOpenChange={vi.fn()} taxRate={existingRate} outletId="o1" onSaved={onSaved} />,
      );

      await userEvent.click(screen.getByText('Active'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(taxRatesApi.update).toHaveBeenCalledWith('t1', expect.objectContaining({ isActive: false }));
    });
  });
});
