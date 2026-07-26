import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupplierFormModal } from './SupplierFormModal';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';

vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, create: vi.fn(), update: vi.fn() } };
});

const currencies = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
];

const existingSupplier: ApiSupplier = {
  id: 's1',
  outletId: 'o1',
  supplierCode: 'SUP-001',
  name: 'Al-Fahad Trading',
  contactPerson: null,
  phone: null,
  email: null,
  addressLine: null,
  city: null,
  stateOrProvince: null,
  countryCode: null,
  postalCode: null,
  preferredCurrency: 'SAR',
  taxRegistrationType: null,
  taxRegistrationNumber: null,
  paymentTerms: null,
  leadTimeDays: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankIfscOrSwift: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('SupplierFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: creating a supplier with a tax registration number and preferred currency sends both to the API', async () => {
    (suppliersApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingSupplier, id: 'new' });
    const onSaved = vi.fn();

    render(
      <SupplierFormModal
        open
        onOpenChange={vi.fn()}
        supplier={null}
        currencies={currencies}
        outletId="o1"
        onSaved={onSaved}
      />,
    );

    await userEvent.type(screen.getByLabelText(/^Name/), 'Al-Fahad Trading');
    await userEvent.selectOptions(screen.getByLabelText('Preferred Currency'), 'SAR');
    await userEvent.type(screen.getByLabelText('Tax Registration Type'), 'VAT Reg. No.');
    await userEvent.type(screen.getByLabelText('Tax Registration Number'), '300123456700003');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(suppliersApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outletId: 'o1',
        name: 'Al-Fahad Trading',
        preferredCurrency: 'SAR',
        taxRegistrationType: 'VAT Reg. No.',
        taxRegistrationNumber: '300123456700003',
      }),
    );
  });

  it('AC: a supplier can be saved with neither tax registration field set', async () => {
    (suppliersApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(existingSupplier);
    const onSaved = vi.fn();

    render(
      <SupplierFormModal open onOpenChange={vi.fn()} supplier={null} currencies={currencies} outletId="o1" onSaved={onSaved} />,
    );
    await userEvent.type(screen.getByLabelText(/^Name/), 'Small Local Supplier');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const payload = (suppliersApi.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.taxRegistrationType).toBeUndefined();
    expect(payload.taxRegistrationNumber).toBeUndefined();
  });

  it('editing pre-fills existing values and calls update, not create', async () => {
    (suppliersApi.update as ReturnType<typeof vi.fn>).mockResolvedValue(existingSupplier);
    const onSaved = vi.fn();

    render(
      <SupplierFormModal
        open
        onOpenChange={vi.fn()}
        supplier={existingSupplier}
        currencies={currencies}
        outletId="o1"
        onSaved={onSaved}
      />,
    );

    expect(screen.getByDisplayValue('Al-Fahad Trading')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SUP-001')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(suppliersApi.update).toHaveBeenCalled();
    expect(suppliersApi.create).not.toHaveBeenCalled();
  });

  it('AC: sanitizes a 403 into a clean generic message, never a raw role/UUID string', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (suppliersApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'Requires role [CHAIN_OWNER, PROPERTY_MANAGER, OUTLET_MANAGER] at outlet 9c1b2e3a-...'),
    );

    render(
      <SupplierFormModal open onOpenChange={vi.fn()} supplier={null} currencies={currencies} outletId="o1" onSaved={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/^Name/), 'Al-Fahad Trading');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("You don't have permission to make this change.")).toBeInTheDocument();
    expect(screen.queryByText(/CHAIN_OWNER/)).not.toBeInTheDocument();
  });
});
