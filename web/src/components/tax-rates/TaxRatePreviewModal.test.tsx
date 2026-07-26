import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaxRatePreviewModal } from './TaxRatePreviewModal';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';

vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return {
    ...actual,
    taxRatesApi: { ...actual.taxRatesApi, preview: vi.fn() },
  };
});

const simpleRate: ApiTaxRate = {
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

const compoundRate: ApiTaxRate = {
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

describe('TaxRatePreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: computes and shows Net/Tax/Gross for a simple rate as a single tax line', async () => {
    (taxRatesApi.preview as ReturnType<typeof vi.fn>).mockResolvedValue({
      lineSubtotal: '100.00',
      lineTaxAmount: '15.00',
      lineTotal: '115.00',
      components: [],
    });

    render(<TaxRatePreviewModal open onOpenChange={vi.fn()} taxRate={simpleRate} />);
    await userEvent.type(screen.getByRole('spinbutton'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(taxRatesApi.preview).toHaveBeenCalledWith('t1', '100'));
    expect(await screen.findByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('15.00')).toBeInTheDocument();
    expect(screen.getByText('115.00')).toBeInTheDocument();
  });

  it('AC: shows an itemized CGST/SGST breakdown for a compound rate, not a lumped figure', async () => {
    (taxRatesApi.preview as ReturnType<typeof vi.fn>).mockResolvedValue({
      lineSubtotal: '200.00',
      lineTaxAmount: '36.00',
      lineTotal: '236.00',
      components: [
        { componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' },
        { componentName: 'SGST', componentRate: '9.00', componentAmount: '18.00' },
      ],
    });

    render(<TaxRatePreviewModal open onOpenChange={vi.fn()} taxRate={compoundRate} />);
    await userEvent.type(screen.getByRole('spinbutton'), '200');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    expect(await screen.findByText('CGST 9.00%: 18.00')).toBeInTheDocument();
    expect(screen.getByText('SGST 9.00%: 18.00')).toBeInTheDocument();
    expect(screen.queryByText('36.00')).not.toBeInTheDocument();
  });

  it('shows the server error message when the preview call fails', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (taxRatesApi.preview as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'Invalid subtotal'));

    render(<TaxRatePreviewModal open onOpenChange={vi.fn()} taxRate={simpleRate} />);
    await userEvent.type(screen.getByRole('spinbutton'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    expect(await screen.findByText('Invalid subtotal')).toBeInTheDocument();
  });

  it('renders nothing when no tax rate is selected', () => {
    const { container } = render(<TaxRatePreviewModal open onOpenChange={vi.fn()} taxRate={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
