import { apiClient } from './api-client';

export interface ApiOutletCurrencySettings {
  baseCurrency: string;
  supportedCurrencies: string[];
}

/** FR-16: base currency is per-outlet (unlike Currency/ExchangeRate
 * themselves) and heavily restricted — see the Currency Configuration
 * screen for the CHAIN_OWNER-only, 409-if-transactional-history rule. */
export const outletsApi = {
  getCurrencySettings: (outletId: string) =>
    apiClient.get<ApiOutletCurrencySettings>(`/outlets/${outletId}/currency-settings`),
  updateCurrencySettings: (outletId: string, baseCurrency: string) =>
    apiClient.patch<ApiOutletCurrencySettings>(`/outlets/${outletId}/currency-settings`, { baseCurrency }),
};
