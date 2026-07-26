import { apiClient } from './api-client';

export interface ApiCurrency {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
}

/** FR-16: global/platform-wide reference data, seeded once for the whole
 * system — not per-outlet, unlike TaxRate. */
export const currenciesApi = {
  list: () => apiClient.get<ApiCurrency[]>('/currencies'),
};
