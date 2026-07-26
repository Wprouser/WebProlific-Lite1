// FR-16: response shape for GET/PATCH /outlets/:id/currency-settings.
// "supportedCurrencies" is simply every registered Currency code — any of
// them can be used to raise a PO/GRN in a non-base currency (see FR-16's
// Approach note); only baseCurrency is fixed per outlet.
export interface OutletCurrencySettings {
  baseCurrency: string;
  supportedCurrencies: string[];
}
