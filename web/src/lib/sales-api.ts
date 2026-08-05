import { apiClient } from './api-client';

export type SaleSourceType = 'WEBHOOK' | 'BATCH_IMPORT' | 'MANUAL';
export type SaleImportStatus = 'STAGED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS';
export type SaleImportRowMatchStatus = 'MATCHED' | 'UNMATCHED' | 'MANUAL';

/** How numeric dates in an uploaded file should be read. Stated by the
 * uploader rather than inferred — `03/04/2026` is genuinely ambiguous and
 * guessing per row would date a January file differently from a July one. */
export const SALES_DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type SalesDateFormat = (typeof SALES_DATE_FORMATS)[number];
export const DEFAULT_SALES_DATE_FORMAT: SalesDateFormat = 'DD/MM/YYYY';

export interface ApiSale {
  id: string;
  outletId: string;
  menuItemId: string;
  menuItemName: string;
  quantitySold: string;
  /** Null means no recipe was in force — nothing was deducted. */
  recipeVersionUsed: number | null;
  posReferenceId: string;
  sourceType: SaleSourceType;
  importBatchId: string | null;
  isVoid: boolean;
  voidedAt: string | null;
  saleTimestamp: string;
  createdAt: string;
}

export interface ApiUnmappedMenuItem {
  menuItemId: string;
  menuItemName: string;
  outletId: string;
  saleCount: number;
  totalQuantitySold: string;
  lastSoldAt: string;
}

export interface ApiSaleWarning {
  code: 'RECIPE_MISSING' | 'LEGACY_RECIPE_DEDUCTION' | 'NEGATIVE_STOCK_ON_SALE';
  message: string;
}

export interface ApiSaleImportBatch {
  id: string;
  outletId: string;
  fileName: string | null;
  importedById: string;
  status: SaleImportStatus;
  totalRows: number;
  processedRows: number;
  createdAt: string;
  processedAt: string | null;
}

export interface ApiSaleImportRow {
  id: string;
  batchId: string;
  rowNumber: number;
  rawMenuItemName: string;
  rawSku: string | null;
  quantitySold: string;
  saleDate: string;
  posReferenceRaw: string | null;
  matchedMenuItemId: string | null;
  matchedMenuItemName: string | null;
  matchStatus: SaleImportRowMatchStatus;
  saleId: string | null;
  skipReason: string | null;
}

export interface ApiProjectedImpact {
  itemId: string;
  itemName: string;
  unitId: string;
  quantity: string;
  currentStock: string;
  /** Negative means running this batch would oversell that ingredient. */
  projectedStock: string;
}

export interface ApiSkippedLine {
  lineNumber: number;
  reason: string;
  raw: string;
}

export interface ApiStagedBatch {
  batch: ApiSaleImportBatch;
  skippedLines: ApiSkippedLine[];
}

export interface ApiBatchReview {
  batch: ApiSaleImportBatch;
  rows: ApiSaleImportRow[];
  matchedCount: number;
  unmatchedCount: number;
  projectedImpact: ApiProjectedImpact[];
  /** Matched, but with no recipe — recorded as sales, deducting nothing. */
  unmappedMenuItemIds: string[];
}

export interface ApiBatchRunResult {
  batch: ApiSaleImportBatch;
  processedRows: number;
  skippedRows: number;
  warnings: { action: ApiSaleWarning['code']; message: string }[];
}

export interface ApiManualSaleResult {
  sale: ApiSale;
  deducted: boolean;
  warnings: ApiSaleWarning[];
}

export interface SaleFilters {
  outletId?: string;
  menuItemId?: string;
  sourceType?: SaleSourceType;
  dateFrom?: string;
  dateTo?: string;
}

function buildQuery(filters: SaleFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.menuItemId) params.set('menuItemId', filters.menuItemId);
  if (filters.sourceType) params.set('sourceType', filters.sourceType);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-06. The webhook endpoints are deliberately absent: they're
 * server-to-server and HMAC-signed, so no browser code ever calls them. */
export const salesApi = {
  list: (filters: SaleFilters = {}) => apiClient.get<ApiSale[]>(`/sales${buildQuery(filters)}`),
  listUnmapped: (outletId?: string) =>
    apiClient.get<ApiUnmappedMenuItem[]>(`/sales/unmapped${outletId ? `?outletId=${outletId}` : ''}`),
  createManual: (input: { menuItemId: string; quantitySold: string; saleTimestamp?: string }) =>
    apiClient.post<ApiManualSaleResult>('/sales/manual', input),

  listBatches: (outletId?: string) =>
    apiClient.get<ApiSaleImportBatch[]>(`/sales/import-batches${outletId ? `?outletId=${outletId}` : ''}`),
  uploadBatch: (outletId: string, file: File, dateFormat: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT) => {
    const formData = new FormData();
    formData.append('outletId', outletId);
    formData.append('dateFormat', dateFormat);
    formData.append('file', file);
    return apiClient.postForm<ApiStagedBatch>('/sales/import-batches', formData);
  },
  reviewBatch: (batchId: string) => apiClient.get<ApiBatchReview>(`/sales/import-batches/${batchId}`),
  assignRow: (batchId: string, rowId: string, menuItemId: string) =>
    apiClient.patch<ApiSaleImportRow>(`/sales/import-batches/${batchId}/rows/${rowId}`, { menuItemId }),
  runBatch: (batchId: string) => apiClient.post<ApiBatchRunResult>(`/sales/import-batches/${batchId}/run`),
};
