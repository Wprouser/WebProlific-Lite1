import { Injectable } from '@nestjs/common';
import { InvoiceOcrProvider, OcrExtractionResult } from './invoice-ocr.provider';

/**
 * Dev/local stand-in for a real vision/document-AI OCR service — no such
 * credentials exist in this environment. Deliberately returns a single
 * low-confidence placeholder line rather than fabricating plausible-looking
 * fake data (that would risk a reviewer mistaking stub output for a real
 * extraction). This still exercises the full async contract (PROCESSING ->
 * EXTRACTED) and the "always pre-fill, never auto-submit" review step —
 * only the vision call itself is faked. Swapping in a real provider means
 * implementing this same interface against that vendor's SDK; nothing else
 * in InvoiceScansService or the GRN flows changes.
 */
@Injectable()
export class DevInvoiceOcrProvider implements InvoiceOcrProvider {
  async extract(): Promise<OcrExtractionResult> {
    return {
      invoiceNumber: undefined,
      supplierNameGuess: undefined,
      lines: [{ itemNameGuess: 'Unidentified item — please review', quantity: '1', unitPrice: '0.00' }],
    };
  }
}
