import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChangeBaseCurrencyModal } from './ChangeBaseCurrencyModal';
import { outletsApi } from '@/lib/outlets-api';

vi.mock('@/lib/outlets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/outlets-api')>('@/lib/outlets-api');
  return { ...actual, outletsApi: { ...actual.outletsApi, updateCurrencySettings: vi.fn() } };
});

const currencies = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
];
const currentSettings = { baseCurrency: 'SAR', supportedCurrencies: ['SAR', 'USD'] };

describe('ChangeBaseCurrencyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: saving calls updateCurrencySettings with the newly selected currency', async () => {
    (outletsApi.updateCurrencySettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      baseCurrency: 'USD',
      supportedCurrencies: ['SAR', 'USD'],
    });
    const onSaved = vi.fn();
    render(
      <ChangeBaseCurrencyModal
        open
        onOpenChange={vi.fn()}
        outletId="o1"
        currentSettings={currentSettings}
        currencies={currencies}
        onSaved={onSaved}
      />,
    );

    await userEvent.selectOptions(screen.getByRole('combobox'), 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(outletsApi.updateCurrencySettings).toHaveBeenCalledWith('o1', 'USD');
  });

  it("AC: shows the server's 409 message verbatim (already written as plain-language copy)", async () => {
    const { ApiError } = await import('@/lib/api-client');
    (outletsApi.updateCurrencySettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(
        409,
        "Base currency can't be changed once transactions exist — contact support if this needs correcting.",
      ),
    );

    render(
      <ChangeBaseCurrencyModal
        open
        onOpenChange={vi.fn()}
        outletId="o1"
        currentSettings={currentSettings}
        currencies={currencies}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Base currency can't be changed once transactions exist/),
    ).toBeInTheDocument();
  });

  it('AC: sanitizes a 403 into a clean generic message, never a raw role/outlet-UUID string', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (outletsApi.updateCurrencySettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'Requires role [CHAIN_OWNER] at outlet 9c1b2e3a-...'),
    );

    render(
      <ChangeBaseCurrencyModal
        open
        onOpenChange={vi.fn()}
        outletId="o1"
        currentSettings={currentSettings}
        currencies={currencies}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("You don't have permission to make this change.")).toBeInTheDocument();
    expect(screen.queryByText(/CHAIN_OWNER/)).not.toBeInTheDocument();
  });
});
