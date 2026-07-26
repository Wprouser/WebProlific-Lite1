import { ExtractedInvoiceData, InvoiceScan } from '../domain/invoice-scan.entity';
import { InvoiceScanProcessingStatus } from '../constants/enums';

export interface CreateInvoiceScanInput {
  outletId: string;
  fileUrl: string;
  createdById: string;
}

export interface UpdateInvoiceScanResultInput {
  status: InvoiceScanProcessingStatus;
  extractedData?: ExtractedInvoiceData;
  failureReason?: string;
}

export interface InvoiceScanRepository {
  create(data: CreateInvoiceScanInput): Promise<InvoiceScan>;
  findById(id: string): Promise<InvoiceScan | null>;
  updateResult(id: string, data: UpdateInvoiceScanResultInput): Promise<InvoiceScan>;
}
