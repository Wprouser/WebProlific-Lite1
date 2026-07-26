import { Item } from '../domain/item.entity';

export interface OpeningStockInput {
  quantity: string;
  // Accepted for API-contract fidelity with the spec's request example, but
  // not persisted as its own column — StockTransaction (FR-02, already
  // built/signed-off) has no rate/price field, and costPrice already
  // captures "cost at creation" for the Item itself, so there's nowhere
  // distinct to store a separately-tracked opening rate without a FR-02
  // schema change outside this FR's scope.
  ratePerUnit?: string;
}

export interface CreateItemInput {
  outletId: string;
  name: string;
  categoryId: string;
  sku: string;
  barcode?: string;
  unit: string;
  minStock: string;
  maxStock: string;
  shelfLifeDays?: number;
  costPrice: string;
  defaultSupplierId?: string;
  purchaseGLAccount?: string;
  defaultTaxRateId?: string;
  storageLocation?: string;
  // Who's performing the create — only needed when openingStock is present,
  // to attribute the resulting OPENING_BALANCE StockTransaction the same
  // way any other transaction records performedById.
  performedById: string;
  openingStock?: OpeningStockInput;
}

// currentStock and outletId are deliberately absent — currentStock is only
// ever mutated by FR-02's Stock Transaction service (spec's business-logic
// rule), and moving an item between outlets isn't a plain field edit (that
// would be a Transfer, FR-08's concern), not something PATCH /items/:id
// should silently allow.
export interface UpdateItemInput {
  name?: string;
  categoryId?: string;
  sku?: string;
  barcode?: string | null;
  unit?: string;
  minStock?: string;
  maxStock?: string;
  shelfLifeDays?: number | null;
  costPrice?: string;
  defaultSupplierId?: string | null;
  purchaseGLAccount?: string | null;
  defaultTaxRateId?: string | null;
  storageLocation?: string | null;
  isActive?: boolean;
}

export interface ItemFilters {
  /** Every result row must have an outletId in this set — scoping, not an
   * explicit user-chosen filter. */
  accessibleOutletIds: string[];
  outletId?: string;
  categoryId?: string;
  isActive?: boolean;
  /** Case-insensitive substring match against name or sku. */
  search?: string;
  /** currentStock < minStock — a cross-column comparison Prisma's `where`
   * can't express directly, so the repository applies it after the main
   * query rather than in SQL. See PrismaItemRepository.findScoped. */
  belowMinStock?: boolean;
}

export interface ItemRepository {
  create(data: CreateItemInput): Promise<Item>;
  findById(id: string): Promise<Item | null>;
  update(id: string, data: UpdateItemInput): Promise<Item>;
  findBySku(sku: string): Promise<Item | null>;
  findByBarcode(barcode: string): Promise<Item | null>;
  findScoped(filters: ItemFilters): Promise<Item[]>;
}
