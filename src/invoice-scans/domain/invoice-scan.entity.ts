import { InvoiceScanProcessingStatus } from '../constants/enums';

export interface ExtractedInvoiceLine {
  itemNameGuess: string;
  quantity: string;
  unitPrice: string;
  // Null when the OCR'd item name couldn't be confidently fuzzy-matched
  // against an existing Item — spec: "the line is shown unmatched and the
  // user picks the correct item manually (or creates a new one)."
  matchedItemId: string | null;
}

export interface ExtractedInvoiceData {
  invoiceNumber?: string;
  supplierNameGuess?: string;
  matchedSupplierId: string | null;
  lines: ExtractedInvoiceLine[];
}

export interface InvoiceScan {
  id: string;
  outletId: string;
  fileUrl: string;
  status: InvoiceScanProcessingStatus;
  extractedData: ExtractedInvoiceData | null;
  failureReason: string | null;
  createdById: string;
  createdAt: Date;
}
