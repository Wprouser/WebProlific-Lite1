import { SupplierPriceHistory } from '../domain/supplier-price-history.entity';

export interface SupplierPriceHistoryFilters {
  supplierId: string;
  itemId?: string;
}

// Read-only — rows are only ever auto-created when a GRN (FR-04) is
// finalized, and that write must land atomically inside GrnRepository's own
// transaction, so it goes through the plain
// `suppliers/lib/record-supplier-price-history.ts` function (called
// directly with the GRN's `tx`) rather than a `create()` method here — same
// reasoning as `stock-transactions/lib/apply-stock-transaction.ts`.
export interface SupplierPriceHistoryRepository {
  findScoped(filters: SupplierPriceHistoryFilters): Promise<SupplierPriceHistory[]>;
}
