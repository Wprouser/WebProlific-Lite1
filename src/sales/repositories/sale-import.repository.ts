import { SaleImportBatch, SaleImportRow, SaleImportRowWithMenuItem } from '../domain/sale.entity';
import { SaleImportRowMatchStatus, SaleImportStatus } from '../constants/enums';

export interface CreateSaleImportRowInput {
  rowNumber: number;
  rawMenuItemName: string;
  rawSku: string | null;
  quantitySold: string;
  saleDate: Date;
  posReferenceRaw: string | null;
  matchedMenuItemId: string | null;
  matchStatus: SaleImportRowMatchStatus;
}

export interface CreateSaleImportBatchInput {
  outletId: string;
  fileName: string | null;
  importedById: string;
  rows: CreateSaleImportRowInput[];
}

export interface SaleImportRepository {
  /** Batch + all its rows in one transaction — a half-written batch would
   * show the user a review screen missing rows their file contained. */
  createWithRows(input: CreateSaleImportBatchInput): Promise<SaleImportBatch>;
  findBatchById(id: string): Promise<SaleImportBatch | null>;
  findBatchesForOutlets(accessibleOutletIds: string[], outletId?: string): Promise<SaleImportBatch[]>;
  findRows(batchId: string): Promise<SaleImportRowWithMenuItem[]>;
  findRowById(rowId: string): Promise<SaleImportRow | null>;
  /** Manual correction on the review screen — sets matchStatus to MANUAL. */
  assignRowMenuItem(rowId: string, menuItemId: string): Promise<SaleImportRow>;
  /** Records the outcome of processing one row during "Run BOM". */
  markRowProcessed(rowId: string, result: { saleId: string | null; skipReason: string | null }): Promise<void>;
  updateBatchStatus(
    id: string,
    update: { status: SaleImportStatus; processedRows?: number; processedAt?: Date },
  ): Promise<SaleImportBatch>;
}
