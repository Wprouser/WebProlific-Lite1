import { apiClient } from './api-client';

export const TRANSACTION_TYPES = [
  'PURCHASE_IN',
  'OPENING_BALANCE',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'USAGE_OUT',
  'WASTAGE_OUT',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const REASON_CODES = ['EXPIRED', 'DAMAGED', 'SPILLED', 'OVER_PREPARED'] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type ReferenceType = 'PO' | 'GRN' | 'TRANSFER' | 'MANUAL';

// Mirrors the backend's TRANSACTION_DIRECTION (src/stock-transactions/constants/enums.ts)
// — OPENING_BALANCE is a stock-in type but doesn't end in "_IN" textually,
// so a plain `type.endsWith('_IN')` string check (as used elsewhere for
// display) would wrongly render it as outbound/red.
export function isInboundTransactionType(type: TransactionType): boolean {
  return type.endsWith('_IN') || type === 'OPENING_BALANCE';
}

export interface ApiStockTransaction {
  id: string;
  outletId: string;
  itemId: string;
  type: TransactionType;
  quantity: string;
  balanceAfter: string;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  reasonCode: ReasonCode | null;
  photoUrl: string | null;
  performedById: string;
  createdAt: string;
}

export interface StockTransactionFilters {
  itemId?: string;
  type?: TransactionType;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateStockTransactionInput {
  itemId: string;
  type: TransactionType;
  quantity: string;
  reasonCode?: ReasonCode;
  forceOverride?: boolean;
}

function buildQuery(filters: StockTransactionFilters): string {
  const params = new URLSearchParams();
  if (filters.itemId) params.set('itemId', filters.itemId);
  if (filters.type) params.set('type', filters.type);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const stockTransactionsApi = {
  list: (filters: StockTransactionFilters) =>
    apiClient.get<ApiStockTransaction[]>(`/stock-transactions${buildQuery(filters)}`),
  create: (input: CreateStockTransactionInput) =>
    apiClient.post<ApiStockTransaction>('/stock-transactions', input),
};
