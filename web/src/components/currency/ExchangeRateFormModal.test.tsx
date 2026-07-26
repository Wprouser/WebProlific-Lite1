import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExchangeRateFormModal } from './ExchangeRateFormModal';
import { exchangeRatesApi } from '@/lib/exchange-rates-api';

vi.mock('@/lib/exchange-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/exchange-rates-api')>('@/lib/exchange-rates-api');
  return { ...actual, exchangeRatesApi: { ...actual.exchangeRatesApi, create: vi.fn() } };
});

const currencies = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
];

describe('ExchangeRateFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: defaults Base Currency to the outlet base currency, and the Target dropdown excludes it', () => {
    render(
      <ExchangeRateFormModal open onOpenChange={vi.fn()} currencies={currencies} defaultBaseCurrency="SAR" onSaved={vi.fn()} />,
    );

    const [baseSelect, targetSelect] = screen.getAllByRole('combobox');
    expect(baseSelect).toHaveValue('SAR');
    const targetOptionValues = Array.from((targetSelect as HTMLSelectElement).options).map((o) => o.value);
    expect(targetOptionValues).not.toContain('SAR');
    expect(targetOptionValues).toEqual(expect.arrayContaining(['USD', 'EUR']));
  });

  it('AC: creating a rate calls create with base/target/rate', async () => {
    (exchangeRatesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'r1',
      baseCurrency: 'SAR',
      targetCurrency: 'USD',
      rate: '0.266667',
      effectiveDate: '2026-01-01T00:00:00.000Z',
      source: 'MANUAL',
    });
    const onSaved = vi.fn();
    render(
      <ExchangeRateFormModal open onOpenChange={vi.fn()} currencies={currencies} defaultBaseCurrency="SAR" onSaved={onSaved} />,
    );

    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(targetSelect, 'USD');
    await userEvent.type(screen.getByPlaceholderText('e.g. 0.266667'), '0.266667');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(exchangeRatesApi.create).toHaveBeenCalledWith({
      baseCurrency: 'SAR',
      targetCurrency: 'USD',
      rate: '0.266667',
    });
  });

  it('AC: sanitizes a 403 into a clean generic message', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (exchangeRatesApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'Requires role [CHAIN_OWNER, PROPERTY_MANAGER]'),
    );

    render(
      <ExchangeRateFormModal open onOpenChange={vi.fn()} currencies={currencies} defaultBaseCurrency="SAR" onSaved={vi.fn()} />,
    );
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(targetSelect, 'USD');
    await userEvent.type(screen.getByPlaceholderText('e.g. 0.266667'), '0.26');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("You don't have permission to make this change.")).toBeInTheDocument();
    expect(screen.queryByText(/CHAIN_OWNER/)).not.toBeInTheDocument();
  });

  it('shows a 400 validation message verbatim (safe, non-sensitive text)', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (exchangeRatesApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, 'Base and target currency must be different'),
    );

    render(
      <ExchangeRateFormModal open onOpenChange={vi.fn()} currencies={currencies} defaultBaseCurrency="SAR" onSaved={vi.fn()} />,
    );
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(targetSelect, 'USD');
    await userEvent.type(screen.getByPlaceholderText('e.g. 0.266667'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Base and target currency must be different')).toBeInTheDocument();
  });
});
