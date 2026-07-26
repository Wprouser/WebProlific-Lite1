import { StockTransaction } from '../domain/stock-transaction.entity';
import { ReasonCode, ReferenceType, TransactionType } from '../constants/enums';

export interface CreateStockTransactionInput {
  outletId: string;
  itemId: string;
  type: TransactionType;
  quantity: string;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  reasonCode: ReasonCode | null;
  performedById: string;
  // Already role-resolved by the service (spec: OUTLET_MANAGER+ passing
  // forceOverride:true) — the repository just needs to know whether a
  // would-go-negative balance is allowed, not who's allowed to ask for it.
  allowNegativeBalance: boolean;
}

/** Bare minimum the service needs post-write — not the full Item domain
 * shape, to avoid coupling this repository to the items module's types. */
export interface UpdatedItemStockSnapshot {
  id: string;
  outletId: string;
  minStock: string;
  currentStock: string;
}

export type CreateStockTransactionResult =
  | { ok: true; transaction: StockTransaction; item: UpdatedItemStockSnapshot }
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; item: UpdatedItemStockSnapshot };

export interface StockTransactionFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  itemId?: string;
  type?: TransactionType;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface StockTransactionRepository {
  /**
   * Atomically: lock+read the item, compute balanceAfter, insert the
   * transaction row, and update Item.currentStock — all inside one
   * Serializable transaction (see the Prisma implementation for why
   * Serializable rather than a raw SQL Server locking hint).
   */
  createWithBalanceUpdate(input: CreateStockTransactionInput): Promise<CreateStockTransactionResult>;
  findById(id: string): Promise<StockTransaction | null>;
  findScoped(filters: StockTransactionFilters): Promise<StockTransaction[]>;
  /** FR-16: whether this outlet has any transactional history at all —
   * used to block base-currency changes once real data exists. Cheap
   * existence check, not a count, since the caller only needs a boolean. */
  existsForOutlet(outletId: string): Promise<boolean>;
}
