import { apiClient } from './api-client';

export interface ApiGrnLineTaxComponent {
  id: string;
  grnLineId: string;
  componentName: string;
  componentRate: string;
  componentAmount: string;
  sortOrder: number;
}

export interface ApiGrnLine {
  id: string;
  grnId: string;
  itemId: string;
  orderedQty: string | null;
  receivedQty: string;
  actualPrice: string;
  taxRateId: string | null;
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  taxComponents: ApiGrnLineTaxComponent[];
}

export interface ApiGrn {
  id: string;
  outletId: string;
  purchaseOrderId: string | null;
  supplierId: string;
  receivedById: string;
  receivedAt: string;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  invoiceNumber: string | null;
  invoiceScanUrl: string | null;
  invoiceScanStatus: 'NONE' | 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'FAILED' | null;
  varianceFlagged: boolean;
  lines: ApiGrnLine[];
  lastEmailedAt: string | null;
  lastEmailedTo: string | null;
}

export interface GrnLineInput {
  itemId: string;
  // Present only for a PO-linked line — echoed back purely so the UI can
  // show it; the server always re-sources the authoritative orderedQty
  // from the PO itself for validation, never trusting this value.
  orderedQty?: string;
  receivedQty: string;
  actualPrice: string;
  taxRateId?: string;
}

export interface CreateDirectGrnInput {
  outletId: string;
  supplierId: string;
  currencyCode?: string;
  exchangeRateToBase?: string;
  isTaxInclusive?: boolean;
  discountAmount?: string;
  otherChargesAmount?: string;
  invoiceNumber?: string;
  // Present when confirming from a Scan Invoice session (Flow 3) — the
  // server attaches that scan's file url onto the created GRN.
  invoiceScanId?: string;
  lines: GrnLineInput[];
}

export interface CreatePoGrnInput {
  currencyCode?: string;
  exchangeRateToBase?: string;
  isTaxInclusive?: boolean;
  discountAmount?: string;
  otherChargesAmount?: string;
  invoiceNumber?: string;
  invoiceScanId?: string;
  lines: GrnLineInput[];
}

export interface SendEmailInput {
  toEmail?: string;
  ccEmails?: string[];
  subject?: string;
  message?: string;
}

export interface GrnFilters {
  outletId?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildQuery(filters: GrnFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.supplierId) params.set('supplierId', filters.supplierId);
  if (filters.purchaseOrderId) params.set('purchaseOrderId', filters.purchaseOrderId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-04's GRN creation flows. Flow 1 (Direct) and Flow 2 (Against a PO)
 * converge on the same GRN/GRNLine records — Flow 3 (Scan Invoice) is
 * Stage 6, layered on top of these same two create calls, not a third. */
export const grnApi = {
  list: (filters: GrnFilters = {}) => apiClient.get<ApiGrn[]>(`/grn${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiGrn>(`/grn/${id}`),
  createDirect: (input: CreateDirectGrnInput) => apiClient.post<ApiGrn>('/grn/direct', input),
  createAgainstPo: (poId: string, input: CreatePoGrnInput) =>
    apiClient.post<ApiGrn>(`/purchase-orders/${poId}/grn`, input),
  getPdf: (id: string) => apiClient.getBlob(`/grn/${id}/pdf`),
  sendEmail: (id: string, input: SendEmailInput) => apiClient.post<ApiGrn>(`/grn/${id}/send-email`, input),
};
