import { apiClient } from './api-client';

export interface ApiExchangeRate {
  id: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: string;
  effectiveDate: string;
  source: 'MANUAL' | 'API';
}

export interface ExchangeRateFilters {
  base?: string;
  target?: string;
}

export interface CreateExchangeRateInput {
  baseCurrency: string;
  targetCurrency: string;
  rate: string;
}

function buildQuery(filters: ExchangeRateFilters): string {
  const params = new URLSearchParams();
  if (filters.base) params.set('base', filters.base);
  if (filters.target) params.set('target', filters.target);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-16: also global/platform-wide (no outletId) — append-only history,
 * "updating" a rate means POSTing a new row with a later effectiveDate;
 * the list always reflects the latest row per (base, target) pair. */
export const exchangeRatesApi = {
  list: (filters: ExchangeRateFilters = {}) =>
    apiClient.get<ApiExchangeRate[]>(`/exchange-rates${buildQuery(filters)}`),
  create: (input: CreateExchangeRateInput) => apiClient.post<ApiExchangeRate>('/exchange-rates', input),
};
