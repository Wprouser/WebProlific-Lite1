import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceScansService } from './invoice-scans.service';
import { InvoiceScanRepository } from '../repositories/invoice-scan.repository';
import { InvoiceOcrProvider } from '../providers/invoice-ocr.provider';
import { InvoiceScan } from '../domain/invoice-scan.entity';
import { StorageRepository } from '../../storage/repositories/storage.repository';
import { SupplierRepository } from '../../suppliers/repositories/supplier.repository';
import { ItemRepository } from '../../items/repositories/item.repository';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureRequest(role: string | null = 'OUTLET_MANAGER'): RequestWithAccess {
  return {
    user: { id: 'u1' },
    effectiveAccess: {
      userId: 'u1',
      effectiveOutletIds: ['o1'],
      effectivePropertyIds: [],
      effectiveChainIds: [],
      effectiveRole: role as never,
      grants: [],
      roleForChain: () => undefined,
      roleForProperty: () => undefined,
      roleForOutlet: () => role as never,
    },
  } as unknown as RequestWithAccess;
}

function fixtureScan(overrides: Partial<InvoiceScan> = {}): InvoiceScan {
  return {
    id: 'scan1',
    outletId: 'o1',
    fileUrl: '/uploads/invoice-scans/inv-123.jpg',
    status: 'PROCESSING',
    extractedData: null,
    failureReason: null,
    createdById: 'u1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('InvoiceScansService', () => {
  function buildService(scan: InvoiceScan = fixtureScan()) {
    const invoiceScanRepository: Partial<InvoiceScanRepository> = {
      create: jest.fn().mockResolvedValue(scan),
      findById: jest.fn().mockResolvedValue(scan),
      updateResult: jest.fn().mockResolvedValue({ ...scan, status: 'EXTRACTED' }),
    };
    const ocrProvider: Partial<InvoiceOcrProvider> = {
      extract: jest.fn().mockResolvedValue({
        invoiceNumber: 'INV-88213',
        supplierNameGuess: 'Al-Fahad Trading',
        lines: [{ itemNameGuess: 'Basmati Rice', quantity: '20', unitPrice: '87.00' }],
      }),
    };
    const storageRepository: Partial<StorageRepository> = {
      save: jest.fn().mockResolvedValue({ url: '/uploads/invoice-scans/inv-123.jpg' }),
    };
    const supplierRepository: Partial<SupplierRepository> = {
      findScoped: jest.fn().mockResolvedValue([{ id: 's1', name: 'Al-Fahad Trading' }]),
    };
    const itemRepository: Partial<ItemRepository> = {
      findScoped: jest.fn().mockResolvedValue([{ id: 'i1', name: 'Basmati Rice' }]),
    };
    const service = new InvoiceScansService(
      invoiceScanRepository as InvoiceScanRepository,
      ocrProvider as InvoiceOcrProvider,
      storageRepository as StorageRepository,
      supplierRepository as SupplierRepository,
      itemRepository as ItemRepository,
    );
    return { service, invoiceScanRepository, ocrProvider, storageRepository, supplierRepository, itemRepository };
  }

  const file = { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg', originalName: 'invoice.jpg' };

  describe('upload', () => {
    it('AC: response is immediate with status PROCESSING (async contract), not waiting for OCR', async () => {
      const { service, invoiceScanRepository } = buildService();
      const result = await service.upload(fixtureRequest(), 'o1', file);
      expect(result.status).toBe('PROCESSING');
      expect(invoiceScanRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ outletId: 'o1', fileUrl: '/uploads/invoice-scans/inv-123.jpg' }),
      );
    });

    it('stores the uploaded file via the swappable StorageRepository', async () => {
      const { service, storageRepository } = buildService();
      await service.upload(fixtureRequest(), 'o1', file);
      expect(storageRepository.save).toHaveBeenCalledWith(file, 'invoice-scans');
    });

    it('AC: STORE_STAFF can upload an invoice scan (broad role set, same as GRN creation)', async () => {
      const { service, invoiceScanRepository } = buildService();
      await service.upload(fixtureRequest('STORE_STAFF'), 'o1', file);
      expect(invoiceScanRepository.create).toHaveBeenCalled();
    });

    it('rejects CHEF from uploading a scan', async () => {
      const { service } = buildService();
      await expect(service.upload(fixtureRequest('CHEF'), 'o1', file)).rejects.toThrow(ForbiddenException);
    });

    it('AC: fuzzy-matches the extracted supplier and item names against existing records', async () => {
      const { service, invoiceScanRepository } = buildService();
      await service.upload(fixtureRequest(), 'o1', file);
      // processExtraction runs fire-and-forget; flush microtasks.
      await new Promise((resolve) => setImmediate(resolve));

      expect(invoiceScanRepository.updateResult).toHaveBeenCalledWith(
        'scan1',
        expect.objectContaining({
          status: 'EXTRACTED',
          extractedData: expect.objectContaining({
            invoiceNumber: 'INV-88213',
            matchedSupplierId: 's1',
            lines: [expect.objectContaining({ itemNameGuess: 'Basmati Rice', matchedItemId: 'i1' })],
          }),
        }),
      );
    });

    it('AC: an OCR-guessed name with no confident match leaves matchedItemId/matchedSupplierId null', async () => {
      const { service, invoiceScanRepository, ocrProvider } = buildService();
      (ocrProvider.extract as jest.Mock).mockResolvedValue({
        invoiceNumber: undefined,
        supplierNameGuess: 'Totally Unknown Vendor',
        lines: [{ itemNameGuess: 'Mystery Ingredient Xyz', quantity: '1', unitPrice: '0.00' }],
      });
      await service.upload(fixtureRequest(), 'o1', file);
      await new Promise((resolve) => setImmediate(resolve));

      expect(invoiceScanRepository.updateResult).toHaveBeenCalledWith(
        'scan1',
        expect.objectContaining({
          extractedData: expect.objectContaining({
            matchedSupplierId: null,
            lines: [expect.objectContaining({ matchedItemId: null })],
          }),
        }),
      );
    });

    it('AC: never auto-submits — a failed OCR call lands the scan in FAILED with a reason, not thrown to the caller', async () => {
      const { service, invoiceScanRepository, ocrProvider } = buildService();
      (ocrProvider.extract as jest.Mock).mockRejectedValue(new Error('vision API unavailable'));

      await expect(service.upload(fixtureRequest(), 'o1', file)).resolves.toBeDefined();
      await new Promise((resolve) => setImmediate(resolve));

      expect(invoiceScanRepository.updateResult).toHaveBeenCalledWith(
        'scan1',
        expect.objectContaining({ status: 'FAILED', failureReason: 'vision API unavailable' }),
      );
    });
  });

  describe('getStatus', () => {
    it('throws NotFoundException for a missing scan', async () => {
      const { service, invoiceScanRepository } = buildService();
      (invoiceScanRepository.findById as jest.Mock).mockResolvedValue(null);
      await expect(service.getStatus(fixtureRequest(), 'missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the scan once extracted', async () => {
      const { service } = buildService(fixtureScan({ status: 'EXTRACTED' }));
      const result = await service.getStatus(fixtureRequest(), 'scan1');
      expect(result.status).toBe('EXTRACTED');
    });
  });
});
