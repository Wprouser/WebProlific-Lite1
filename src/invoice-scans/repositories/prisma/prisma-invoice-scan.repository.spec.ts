import { PrismaInvoiceScanRepository } from './prisma-invoice-scan.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
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

describe('PrismaInvoiceScanRepository', () => {
  function buildRepository(row = fixtureRow()) {
    const create = jest.fn().mockResolvedValue(row);
    const findUnique = jest.fn().mockResolvedValue(row);
    const update = jest.fn().mockResolvedValue(row);
    const prisma = { invoiceScan: { create, findUnique, update } };
    const repository = new PrismaInvoiceScanRepository(prisma as any);
    return { repository, create, findUnique, update };
  }

  describe('create', () => {
    it('creates a row with the given outletId/fileUrl/createdById', async () => {
      const { repository, create } = buildRepository();
      await repository.create({ outletId: 'o1', fileUrl: '/uploads/invoice-scans/inv-123.jpg', createdById: 'u1' });
      expect(create).toHaveBeenCalledWith({
        data: { outletId: 'o1', fileUrl: '/uploads/invoice-scans/inv-123.jpg', createdById: 'u1' },
      });
    });
  });

  describe('findById', () => {
    it('deserializes extractedData JSON back into an object', async () => {
      const extracted = { invoiceNumber: 'INV-1', matchedSupplierId: 's1', lines: [] };
      const { repository } = buildRepository(fixtureRow({ status: 'EXTRACTED', extractedData: JSON.stringify(extracted) }));
      const result = await repository.findById('scan1');
      expect(result?.extractedData).toEqual(extracted);
    });

    it('returns null extractedData while still PROCESSING', async () => {
      const { repository } = buildRepository();
      const result = await repository.findById('scan1');
      expect(result?.extractedData).toBeNull();
    });

    it('returns null for a missing row', async () => {
      const { repository, findUnique } = buildRepository();
      findUnique.mockResolvedValue(null);
      expect(await repository.findById('missing')).toBeNull();
    });
  });

  describe('updateResult', () => {
    it('AC: serializes extractedData to JSON at the write boundary', async () => {
      const { repository, update } = buildRepository();
      const extracted = { invoiceNumber: 'INV-1', matchedSupplierId: null, lines: [] };
      await repository.updateResult('scan1', { status: 'EXTRACTED', extractedData: extracted });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'scan1' },
        data: { status: 'EXTRACTED', extractedData: JSON.stringify(extracted), failureReason: undefined },
      });
    });

    it('records a failureReason when the scan fails', async () => {
      const { repository, update } = buildRepository();
      await repository.updateResult('scan1', { status: 'FAILED', failureReason: 'blurry image' });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'scan1' },
        data: { status: 'FAILED', extractedData: undefined, failureReason: 'blurry image' },
      });
    });
  });
});
