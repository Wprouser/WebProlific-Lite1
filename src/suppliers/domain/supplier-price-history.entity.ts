export interface SupplierPriceHistory {
  id: string;
  supplierId: string;
  itemId: string;
  price: string; // Decimal(12,2) serialized as a fixed-precision string
  currencyCode: string;
  // null only for rows recorded before this column existed.
  priceInBaseCurrency: string | null;
  recordedAt: Date;
  source: 'PO' | 'GRN' | 'MANUAL';
}
