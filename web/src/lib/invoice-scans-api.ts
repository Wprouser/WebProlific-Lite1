import { apiClient } from './api-client';

export interface ApiExtractedLine {
  itemNameGuess: string;
  quantity: string;
  unitPrice: string;
  matchedItemId: string | null;
}

export interface ApiExtractedInvoiceData {
  invoiceNumber?: string;
  supplierNameGuess?: string;
  matchedSupplierId: string | null;
  lines: ApiExtractedLine[];
}

export interface ApiInvoiceScan {
  id: string;
  outletId: string;
  fileUrl: string;
  status: 'PROCESSING' | 'EXTRACTED' | 'FAILED';
  extractedData: ApiExtractedInvoiceData | null;
  failureReason: string | null;
  createdById: string;
  createdAt: string;
}

/** FR-04's GRN Flow 3 (AI-04 Scan Invoice) — upload always returns
 * immediately with status PROCESSING; the caller polls getStatus until it
 * settles to EXTRACTED or FAILED. Confirming into a real GRN happens via
 * the existing purchaseOrdersApi/grnApi create calls (passing this scan's
 * id back), never automatically from here. */
export const invoiceScansApi = {
  upload: (outletId: string, file: File) => {
    const formData = new FormData();
    formData.append('outletId', outletId);
    formData.append('file', file);
    return apiClient.postForm<ApiInvoiceScan>('/invoice-scans', formData);
  },
  getStatus: (id: string) => apiClient.get<ApiInvoiceScan>(`/invoice-scans/${id}`),
};
