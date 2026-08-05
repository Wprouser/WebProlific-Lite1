import { apiClient } from './api-client';
import type { ApiPurchaseOrder } from './purchase-orders-api';

export type AlertType = 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRY_WARNING';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface ApiAlert {
  id: string;
  outletId: string;
  itemId: string | null;
  itemName: string | null;
  type: AlertType;
  status: AlertStatus;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

/**
 * Counts behind the Global Alert Bar. Three come from FR-07 alerts, two from
 * FR-04 document states — the bar has always shown all five, and until now
 * all five were mocked.
 */
export interface ApiAlertSummary {
  lowStock: number;
  expiry: number;
  unacknowledged: number;
  poApprovals: number;
  grnVariance: number;
}

export interface AlertFilters {
  outletId?: string;
  status?: AlertStatus;
  type?: AlertType;
}

function buildQuery(filters: AlertFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const alertsApi = {
  list: (filters: AlertFilters = {}) => apiClient.get<ApiAlert[]>(`/alerts${buildQuery(filters)}`),
  summary: (outletId?: string) =>
    apiClient.get<ApiAlertSummary>(`/alerts/summary${outletId ? `?outletId=${outletId}` : ''}`),
  acknowledge: (id: string) => apiClient.patch<ApiAlert>(`/alerts/${id}/acknowledge`),
  resolve: (id: string) => apiClient.patch<ApiAlert>(`/alerts/${id}/resolve`),
  /** Reorder shortcut — returns the DRAFT PO it created. */
  createPoDraft: (id: string) => apiClient.post<ApiPurchaseOrder>(`/alerts/${id}/create-po-draft`),
};
