// Application-layer stand-ins for FR-06's String-backed enum columns —
// Prisma's SQL Server connector rejects the `enum` construct outright (see
// prisma/schema.prisma's header note), so these are the single source of
// truth for allowed values, same pattern as every other module here.

export const SALE_SOURCE_TYPES = ['WEBHOOK', 'BATCH_IMPORT', 'MANUAL'] as const;
export type SaleSourceType = (typeof SALE_SOURCE_TYPES)[number];

export const SALE_IMPORT_STATUSES = ['STAGED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS'] as const;
export type SaleImportStatus = (typeof SALE_IMPORT_STATUSES)[number];

export const SALE_IMPORT_ROW_MATCH_STATUSES = ['MATCHED', 'UNMATCHED', 'MANUAL'] as const;
export type SaleImportRowMatchStatus = (typeof SALE_IMPORT_ROW_MATCH_STATUSES)[number];

/**
 * How to read a numeric date in an uploaded sales file.
 *
 * `03/04/2026` is 3 April to most of the world and 4 March in the US, and
 * nothing in the file itself says which. Inferring it per row is the one
 * option that's actually dangerous: a January export would be read
 * differently from a July one, silently, because in one of them the first
 * number happened to exceed 12. So the uploader states it, once, per file.
 *
 * Not persisted — it only governs parsing at upload time, after which every
 * staged row holds a real DateTime.
 */
export const SALES_DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type SalesDateFormat = (typeof SALES_DATE_FORMATS)[number];

/** Day-first: the launch markets (Gulf, South Asia) write dates this way. */
export const DEFAULT_SALES_DATE_FORMAT: SalesDateFormat = 'DD/MM/YYYY';

/**
 * Why these three are ActivityLog `ALERT` rather than a new WARNING
 * category: FR-18's ActivityCategory list has no WARNING, and ALERT is
 * already the "something needs a human's attention" bucket. Adding a
 * category would mean touching the FR-18 enum for three actions that fit an
 * existing one.
 *
 * All three carry `entityType: 'MenuItem'` + `entityId`, deliberately — an
 * indexed lookup is what makes the Unmapped Items worklist a real query
 * instead of a scan over serialized metadata strings.
 */
export const SALE_WARNING_ACTIONS = {
  /** Sold, but the menu item has no current recipe — nothing was deducted. */
  RECIPE_MISSING: 'RECIPE_MISSING',
  /** Deducted through a yield-less sub-recipe, using the pre-amendment
   * batch-multiplier reading. The deduction is real but imprecise; the named
   * recipe needs a yield set. */
  LEGACY_RECIPE_DEDUCTION: 'LEGACY_RECIPE_DEDUCTION',
  /** The deduction drove an ingredient below zero. Recorded, not refused. */
  NEGATIVE_STOCK_ON_SALE: 'NEGATIVE_STOCK_ON_SALE',
} as const;
export type SaleWarningAction = (typeof SALE_WARNING_ACTIONS)[keyof typeof SALE_WARNING_ACTIONS];

/** FR-11 permission matrix: manual sale entry and running a batch move real
 * stock, so they sit with the other stock-moving roles. CHEF is included for
 * the same reason FR-02 lets a CHEF post usage. */
export const SALES_MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'CHEF'] as const;
