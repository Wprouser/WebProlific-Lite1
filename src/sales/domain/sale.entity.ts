import { SaleImportRowMatchStatus, SaleImportStatus, SaleSourceType } from '../constants/enums';

export interface Sale {
  id: string;
  outletId: string;
  menuItemId: string;
  /** Decimal(10,3) as a fixed-precision string. */
  quantitySold: string;
  /** Null when the menu item had no recipe at the time — nothing was
   * deducted, and this sale is on the Unmapped Items worklist. */
  recipeVersionUsed: number | null;
  posReferenceId: string;
  sourceType: SaleSourceType;
  importBatchId: string | null;
  isVoid: boolean;
  voidedAt: Date | null;
  saleTimestamp: Date;
  createdAt: Date;
}

/** Sale plus the menu item's name — what every list screen actually needs,
 * and not worth a second round-trip per row. */
export interface SaleWithMenuItem extends Sale {
  menuItemName: string;
}

export interface SaleImportBatch {
  id: string;
  outletId: string;
  fileName: string | null;
  importedById: string;
  status: SaleImportStatus;
  totalRows: number;
  processedRows: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface SaleImportRow {
  id: string;
  batchId: string;
  rowNumber: number;
  rawMenuItemName: string;
  rawSku: string | null;
  quantitySold: string;
  saleDate: Date;
  posReferenceRaw: string | null;
  matchedMenuItemId: string | null;
  matchStatus: SaleImportRowMatchStatus;
  saleId: string | null;
  skipReason: string | null;
}

export interface SaleImportRowWithMenuItem extends SaleImportRow {
  /** Null while unmatched. */
  matchedMenuItemName: string | null;
}

/**
 * One entry of the Unmapped Items worklist: a menu item that has been sold
 * but had no recipe to deduct through.
 *
 * Derived from Sale rows (`recipeVersionUsed IS NULL`) rather than by
 * scanning ActivityLog warnings. Both exist — the spec requires the warning
 * event — but the Sale table is the indexed, aggregate-friendly one, and it
 * cannot drift from what actually happened.
 */
export interface UnmappedMenuItem {
  menuItemId: string;
  menuItemName: string;
  outletId: string;
  /** How many sales went through unmapped, and how much was sold. */
  saleCount: number;
  totalQuantitySold: string;
  lastSoldAt: Date;
}
