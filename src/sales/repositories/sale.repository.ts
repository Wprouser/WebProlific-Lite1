import { Sale, SaleWithMenuItem, UnmappedMenuItem } from '../domain/sale.entity';
import { SaleSourceType } from '../constants/enums';

export interface CreateSaleInput {
  outletId: string;
  menuItemId: string;
  quantitySold: string;
  recipeVersionUsed: number | null;
  posReferenceId: string;
  sourceType: SaleSourceType;
  importBatchId: string | null;
  saleTimestamp: Date;
}

export interface SaleFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  menuItemId?: string;
  sourceType?: SaleSourceType;
  dateFrom?: Date;
  dateTo?: Date;
  /** Worklist filter: only sales that deducted nothing for want of a recipe. */
  unmappedOnly?: boolean;
}

export interface SaleRepository {
  /**
   * Inserts a sale, or returns the existing row when `posReferenceId` is
   * already taken.
   *
   * Idempotency is the unique constraint, not a prior read: a POS that
   * retries a webhook in parallel with the original would pass a
   * check-then-insert and double-deduct. The implementation therefore
   * catches the unique violation and returns `created: false`.
   */
  createIfAbsent(input: CreateSaleInput): Promise<{ sale: Sale; created: boolean }>;
  findById(id: string): Promise<Sale | null>;
  findByPosReferenceId(posReferenceId: string): Promise<Sale | null>;
  markVoided(id: string, voidedAt: Date): Promise<Sale>;
  findScoped(filters: SaleFilters): Promise<SaleWithMenuItem[]>;
  /** FR-06 Screens: the Unmapped Items worklist, aggregated per menu item. */
  findUnmappedMenuItems(accessibleOutletIds: string[], outletId?: string): Promise<UnmappedMenuItem[]>;
}
