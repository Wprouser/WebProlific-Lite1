export interface OcrExtractedLine {
  itemNameGuess: string;
  quantity: string;
  unitPrice: string;
}

export interface OcrExtractionResult {
  invoiceNumber?: string;
  supplierNameGuess?: string;
  lines: OcrExtractedLine[];
}

/**
 * Swappable OCR/document-AI boundary (spec: "the underlying OCR call
 * itself is an external vision/document-AI service, swapped in behind this
 * endpoint rather than built from scratch") — mirrors this project's
 * Repository Pattern / StorageRepository precedent so a real vendor SDK
 * (Google Document AI, AWS Textract, etc.) can replace DevInvoiceOcrProvider
 * later without touching InvoiceScansService.
 */
export interface InvoiceOcrProvider {
  extract(file: { buffer: Buffer; mimetype: string }): Promise<OcrExtractionResult>;
}
