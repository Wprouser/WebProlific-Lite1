import { Prisma } from '@prisma/client';
import { convertToBaseCurrency } from '../../purchase-orders/lib/apply-document-tax';

/**
 * Plain function (not a Nest provider) so GrnRepository can call it from
 * inside its own `prisma.$transaction` without SuppliersModule needing to
 * export a tx-aware repository method or GrnModule needing to import
 * SuppliersModule for this — same reasoning and precedent as
 * `stock-transactions/lib/apply-stock-transaction.ts`. Rows are always
 * auto-created on GRN finalization (spec's Business Logic), never via a
 * standalone create endpoint, so there's no matching method on
 * SupplierPriceHistoryRepository (which stays read-only, per its own
 * doc comment).
 */
export interface RecordSupplierPriceHistoryInput {
  supplierId: string;
  itemId: string;
  price: string;
  currencyCode: string;
  // The recording document's snapshotted rate to the outlet's base
  // currency — used to compute priceInBaseCurrency so cross-supplier price
  // comparisons remain valid even when suppliers bill in different
  // currencies (spec: FR-04 GRN business logic).
  exchangeRateToBase: string;
  source: 'PO' | 'GRN' | 'MANUAL';
}

export async function recordSupplierPriceHistory(
  tx: Prisma.TransactionClient,
  input: RecordSupplierPriceHistoryInput,
): Promise<void> {
  const priceInBaseCurrency = convertToBaseCurrency(input.price, input.exchangeRateToBase);

  await tx.supplierPriceHistory.create({
    data: {
      supplierId: input.supplierId,
      itemId: input.itemId,
      price: input.price,
      currencyCode: input.currencyCode,
      priceInBaseCurrency,
      source: input.source,
    },
  });
}
