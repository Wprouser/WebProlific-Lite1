export const OUTLET_CREATED_EVENT = 'outlet.created';

export interface OutletCreatedEvent {
  outletId: string;
  // Added so listeners can seed currency/locale-appropriate reference data
  // (e.g. DefaultTaxRatesListener) without needing their own Outlet lookup
  // — the service already has the freshly created outlet in hand.
  baseCurrency: string;
}
