import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { INVOICE_SCAN_REPOSITORY } from '../repositories/tokens';
import { InvoiceScanRepository } from '../repositories/invoice-scan.repository';
import { INVOICE_OCR_PROVIDER } from '../providers/tokens';
import { InvoiceOcrProvider } from '../providers/invoice-ocr.provider';
import { InvoiceScan } from '../domain/invoice-scan.entity';
import { INVOICE_SCAN_CREATE_ROLES } from '../constants/enums';
import { findBestFuzzyMatch } from '../lib/fuzzy-match';
import { STORAGE_REPOSITORY } from '../../storage/repositories/tokens';
import { StorageRepository, StoredFileInput } from '../../storage/repositories/storage.repository';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { SUPPLIER_REPOSITORY } from '../../suppliers/repositories/tokens';
import { SupplierRepository } from '../../suppliers/repositories/supplier.repository';
import { ITEM_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';

@Injectable()
export class InvoiceScansService {
  constructor(
    @Inject(INVOICE_SCAN_REPOSITORY) private readonly invoiceScanRepository: InvoiceScanRepository,
    @Inject(INVOICE_OCR_PROVIDER) private readonly ocrProvider: InvoiceOcrProvider,
    @Inject(STORAGE_REPOSITORY) private readonly storageRepository: StorageRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly supplierRepository: SupplierRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
  ) {}

  /** Spec: `POST /grn/:id/scan-invoice` returns 202 with scanStatus:
   * PROCESSING immediately — the OCR call itself runs after this method
   * returns (see processExtraction), never awaited here. */
  async upload(request: RequestWithAccess, outletId: string, file: StoredFileInput): Promise<InvoiceScan> {
    assertOutletAccess(request, outletId, [...INVOICE_SCAN_CREATE_ROLES]);

    const stored = await this.storageRepository.save(file, 'invoice-scans');
    const scan = await this.invoiceScanRepository.create({
      outletId,
      fileUrl: stored.url,
      createdById: request.user!.id,
    });

    void this.processExtraction(scan.id, outletId, file);

    return scan;
  }

  async getStatus(request: RequestWithAccess, id: string): Promise<InvoiceScan> {
    const scan = await this.getOrThrow(id);
    assertOutletAccess(request, scan.outletId);
    return scan;
  }

  /**
   * Spec: "extracted line items are fuzzy-matched against existing Item
   * records by name/SKU where possible... unmatched lines are returned
   * as-is for manual mapping" — same for the vendor guess against Supplier.
   * Never throws upward; any failure (OCR call, storage, etc.) lands the
   * scan in FAILED with a reason, per spec's `invoiceScanStatus: 'FAILED'
   * with a reason if the scan couldn't be processed`.
   */
  private async processExtraction(
    scanId: string,
    outletId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<void> {
    try {
      const raw = await this.ocrProvider.extract(file);
      const [suppliers, items] = await Promise.all([
        this.supplierRepository.findScoped({ accessibleOutletIds: [outletId], outletId }),
        this.itemRepository.findScoped({ accessibleOutletIds: [outletId], outletId }),
      ]);

      const matchedSupplierId = findBestFuzzyMatch(
        raw.supplierNameGuess,
        suppliers.map((s) => ({ id: s.id, name: s.name })),
      );

      await this.invoiceScanRepository.updateResult(scanId, {
        status: 'EXTRACTED',
        extractedData: {
          invoiceNumber: raw.invoiceNumber,
          supplierNameGuess: raw.supplierNameGuess,
          matchedSupplierId,
          lines: raw.lines.map((line) => ({
            itemNameGuess: line.itemNameGuess,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            matchedItemId: findBestFuzzyMatch(
              line.itemNameGuess,
              items.map((i) => ({ id: i.id, name: i.name })),
            ),
          })),
        },
      });
    } catch (err) {
      await this.invoiceScanRepository.updateResult(scanId, {
        status: 'FAILED',
        failureReason: err instanceof Error ? err.message : 'OCR extraction failed',
      });
    }
  }

  private async getOrThrow(id: string): Promise<InvoiceScan> {
    const scan = await this.invoiceScanRepository.findById(id);
    if (!scan) throw new NotFoundException(`Invoice scan ${id} not found`);
    return scan;
  }
}
