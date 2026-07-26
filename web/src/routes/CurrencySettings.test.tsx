import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CurrencySettings } from './CurrencySettings';
import { currenciesApi } from '@/lib/currencies-api';
import { exchangeRatesApi } from '@/lib/exchange-rates-api';
import { outletsApi } from '@/lib/outlets-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/currencies-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/currencies-api')>('@/lib/currencies-api');
  return { ...actual, currenciesApi: { ...actual.currenciesApi, list: vi.fn() } };
});
vi.mock('@/lib/exchange-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/exchange-rates-api')>('@/lib/exchange-rates-api');
  return { ...actual, exchangeRatesApi: { ...actual.exchangeRatesApi, list: vi.fn(), create: vi.fn() } };
});
vi.mock('@/lib/outlets-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/outlets-api')>('@/lib/outlets-api');
  return {
    ...actual,
    outletsApi: { ...actual.outletsApi, getCurrencySettings: vi.fn(), updateCurrencySettings: vi.fn() },
  };
});

const currencies = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
];

const rate = {
  id: 'r1',
  baseCurrency: 'SAR',
  targetCurrency: 'USD',
  rate: '0.266667',
  effectiveDate: '2026-01-01T00:00:00.000Z',
  source: 'MANUAL' as const,
};

function setRole(role: string) {
  setSession({
    accessToken: 'token',
    refreshToken: 'refresh-token',
    user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: role, effectiveOutletIds: ['o1'] },
  });
}

describe('CurrencySettings screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (currenciesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue(currencies);
    (outletsApi.getCurrencySettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      baseCurrency: 'SAR',
      supportedCurrencies: ['SAR', 'USD'],
    });
    (exchangeRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([rate]);
  });

  it("AC: displays the outlet's base currency prominently", async () => {
    setRole('PROPERTY_MANAGER');
    render(<CurrencySettings />);
    expect(await screen.findByText('SAR — Saudi Riyal')).toBeInTheDocument();
  });

  it('AC: filters the exchange-rate list request to the outlet base currency', async () => {
    setRole('PROPERTY_MANAGER');
    render(<CurrencySettings />);
    await screen.findByText('SAR — Saudi Riyal');
    expect(exchangeRatesApi.list).toHaveBeenCalledWith({ base: 'SAR' });
  });

  it('AC: renders the exchange rates table with the right columns', async () => {
    setRole('PROPERTY_MANAGER');
    render(<CurrencySettings />);
    // ResponsiveTable renders both a <table> and a stacked-card layout
    // simultaneously (CSS picks the visible one per viewport), so every
    // value appears twice in the DOM — getAllByText, not getByText.
    expect((await screen.findAllByText('Target Currency')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Effective Date').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Source').length).toBeGreaterThan(0);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.266667').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manual').length).toBeGreaterThan(0);
  });

  describe('RBAC gating', () => {
    it('AC: CHAIN_OWNER sees both "Change base currency" and "Add rate"', async () => {
      setRole('CHAIN_OWNER');
      render(<CurrencySettings />);
      await screen.findByText('SAR — Saudi Riyal');
      expect(screen.getByRole('button', { name: 'Change base currency' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add rate' })).toBeInTheDocument();
    });

    it('AC: PROPERTY_MANAGER sees "Add rate" but not "Change base currency"', async () => {
      setRole('PROPERTY_MANAGER');
      render(<CurrencySettings />);
      await screen.findByText('SAR — Saudi Riyal');
      expect(screen.queryByRole('button', { name: 'Change base currency' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add rate' })).toBeInTheDocument();
    });

    it('AC: OUTLET_MANAGER sees neither action — read-only, matching the Tax Configuration screen fix', async () => {
      setRole('OUTLET_MANAGER');
      render(<CurrencySettings />);
      await screen.findByText('SAR — Saudi Riyal');
      expect(screen.queryByRole('button', { name: 'Change base currency' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add rate' })).not.toBeInTheDocument();
    });
  });

  it('shows an empty state (with no Add rate action for a read-only role) when there are no rates yet', async () => {
    (exchangeRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    setRole('OUTLET_MANAGER');
    render(<CurrencySettings />);
    expect(await screen.findByText('No exchange rates yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rate' })).not.toBeInTheDocument();
  });
});
