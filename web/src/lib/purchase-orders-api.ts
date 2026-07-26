import { apiClient } from './api-client';

export type POStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT_TO_SUPPLIER'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED';

export interface ApiPOLineTaxComponent {
  id: string;
  poLineId: string;
  componentName: string;
  componentRate: string;
  componentAmount: string;
  sortOrder: number;
}

export interface ApiPOLine {
  id: string;
  purchaseOrderId: string;
  itemId: string;
  orderedQty: string;
  expectedPrice: string;
  taxRateId: string | null;
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  receivedQty: string;
  taxComponents: ApiPOLineTaxComponent[];
}

export interface ApiPurchaseOrder {
  id: string;
  outletId: string;
  supplierId: string;
  status: POStatus;
  expectedDeliveryDate: string | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  lines: ApiPOLine[];
  createdAt: string;
  lastEmailedAt: string | null;
  lastEmailedTo: string | null;
}

export interface POLineInput {
  itemId: string;
  orderedQty: string;
  expectedPrice: string;
  taxRateId?: string;
}

export interface CreatePurchaseOrderInput {
  outletId: string;
  supplierId: string;
  currencyCode?: string;
  exchangeRateToBase?: string;
  isTaxInclusive?: boolean;
  discountAmount?: string;
  otherChargesAmount?: string;
  expectedDeliveryDate?: string;
  lines: POLineInput[];
}

export type UpdatePurchaseOrderInput = Partial<Omit<CreatePurchaseOrderInput, 'outletId'>>;

export interface SendEmailInput {
  toEmail?: string;
  ccEmails?: string[];
  subject?: string;
  message?: string;
}

export interface POFilters {
  outletId?: string;
  status?: POStatus;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildQuery(filters: POFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.status) params.set('status', filters.status);
  if (filters.supplierId) params.set('supplierId', filters.supplierId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-04's Purchase Order lifecycle — create (DRAFT), edit while still
 * DRAFT, then submit/approve/reject/send/close move it through the rest of
 * the workflow. Tax/currency amounts are always server-computed. */
export const purchaseOrdersApi = {
  list: (filters: POFilters = {}) => apiClient.get<ApiPurchaseOrder[]>(`/purchase-orders${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiPurchaseOrder>(`/purchase-orders/${id}`),
  create: (input: CreatePurchaseOrderInput) => apiClient.post<ApiPurchaseOrder>('/purchase-orders', input),
  update: (id: string, input: UpdatePurchaseOrderInput) =>
    apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}`, input),
  submit: (id: string) => apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}/submit`, undefined),
  approve: (id: string) => apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}/approve`, undefined),
  reject: (id: string, reason: string) =>
    apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}/reject`, { reason }),
  send: (id: string) => apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}/send`, undefined),
  close: (id: string) => apiClient.patch<ApiPurchaseOrder>(`/purchase-orders/${id}/close`, undefined),
  getPdf: (id: string) => apiClient.getBlob(`/purchase-orders/${id}/pdf`),
  sendEmail: (id: string, input: SendEmailInput) =>
    apiClient.post<ApiPurchaseOrder>(`/purchase-orders/${id}/send-email`, input),
};
