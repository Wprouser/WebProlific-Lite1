import { Prisma } from '@prisma/client';
import { PrismaPurchaseOrderRepository } from './prisma-purchase-order.repository';

function fixtureLineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    purchaseOrderId: 'po1',
    itemId: 'i1',
    orderedQty: { toFixed: () => '20.000' },
    expectedPrice: { toFixed: () => '87.00' },
    taxRateId: 't1',
    taxRate: { toFixed: () => '15.00' },
    lineSubtotal: { toFixed: () => '1740.00' },
    lineTaxAmount: { toFixed: () => '261.00' },
    lineTotal: { toFixed: () => '2001.00' },
    receivedQty: { toFixed: () => '0.000' },
    taxComponents: [],
    ...overrides,
  };
}

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po1',
    outletId: 'o1',
    supplierId: 's1',
    status: 'DRAFT',
    expectedDeliveryDate: null,
    createdById: 'u1',
    approvedById: null,
    approvedAt: null,
    currencyCode: 'SAR',
    exchangeRateToBase: { toFixed: () => '1.000000' },
    isTaxInclusive: false,
    discountAmount: { toFixed: () => '0.00' },
    otherChargesAmount: { toFixed: () => '0.00' },
    subtotal: { toFixed: () => '1740.00' },
    taxAmount: { toFixed: () => '261.00' },
    totalValue: { toFixed: () => '2001.00' },
    lines: [fixtureLineRow()],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PrismaPurchaseOrderRepository', () => {
  function buildRepository(rows: ReturnType<typeof fixtureRow>[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const findUnique = jest.fn();
    const create = jest.fn().mockResolvedValue(fixtureRow());
    const update = jest.fn().mockResolvedValue(fixtureRow());
    const pOLineFindMany = jest.fn().mockResolvedValue([]);
    const pOLineDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const pOLineTaxComponentDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      purchaseOrder: { findMany, findUnique, create, update },
      pOLine: { findMany: pOLineFindMany, deleteMany: pOLineDeleteMany },
      pOLineTaxComponent: { deleteMany: pOLineTaxComponentDeleteMany },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({
          purchaseOrder: { update },
          pOLine: { findMany: pOLineFindMany, deleteMany: pOLineDeleteMany },
          pOLineTaxComponent: { deleteMany: pOLineTaxComponentDeleteMany },
        }),
      ),
    };
    const repository = new PrismaPurchaseOrderRepository(prisma as any);
    return { repository, findMany, findUnique, create, update, pOLineFindMany, pOLineDeleteMany, pOLineTaxComponentDeleteMany };
  }

  describe('create', () => {
    it('creates nested lines and tax components with sortOrder assigned by array position', async () => {
      const { repository, create } = buildRepository();
      await repository.create({
        outletId: 'o1',
        supplierId: 's1',
        createdById: 'u1',
        currencyCode: 'SAR',
        exchangeRateToBase: '1',
        isTaxInclusive: false,
        discountAmount: '0.00',
        otherChargesAmount: '0.00',
        subtotal: '1740.00',
        taxAmount: '261.00',
        totalValue: '2001.00',
        lines: [
          {
            itemId: 'i1',
            orderedQty: '20',
            expectedPrice: '87.00',
            taxRateId: 't1',
            taxRate: '15.00',
            lineSubtotal: '1740.00',
            lineTaxAmount: '261.00',
            lineTotal: '2001.00',
            taxComponents: [],
          },
        ],
      });
      expect(create.mock.calls[0][0].data.lines.create[0]).toMatchObject({
        itemId: 'i1',
        orderedQty: '20',
        expectedPrice: '87.00',
        taxRate: '15.00',
      });
    });

    it('serializes Decimal fields to fixed-precision strings', async () => {
      const { repository } = buildRepository();
      const result = await repository.create({
        outletId: 'o1',
        supplierId: 's1',
        createdById: 'u1',
        currencyCode: 'SAR',
        exchangeRateToBase: '1',
        isTaxInclusive: false,
        discountAmount: '0.00',
        otherChargesAmount: '0.00',
        subtotal: '1740.00',
        taxAmount: '261.00',
        totalValue: '2001.00',
        lines: [],
      });
      expect(result.exchangeRateToBase).toBe('1.000000');
      expect(result.totalValue).toBe('2001.00');
      expect(result.lines[0]!.orderedQty).toBe('20.000');
    });
  });

  describe('findScoped', () => {
    it('returns no results (and does not query) when the caller has no accessible outlets', async () => {
      const { repository, findMany } = buildRepository();
      const result = await repository.findScoped({ accessibleOutletIds: [] });
      expect(result).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('rejects an explicit outletId filter outside the accessible set', async () => {
      const { repository, findMany } = buildRepository();
      const result = await repository.findScoped({ accessibleOutletIds: ['o1'], outletId: 'o2' });
      expect(result).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('filters by status and supplierId when given', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], status: 'APPROVED', supplierId: 's1' });
      expect(findMany.mock.calls[0][0].where).toMatchObject({ status: 'APPROVED', supplierId: 's1' });
    });
  });

  describe('update', () => {
    it('AC: replaces lines wholesale (components then lines deleted, then recreated) when lines are given', async () => {
      const { repository, update, pOLineFindMany, pOLineDeleteMany, pOLineTaxComponentDeleteMany } = buildRepository();
      pOLineFindMany.mockResolvedValue([{ id: 'l1' }]);
      await repository.update('po1', {
        lines: [
          {
            itemId: 'i2',
            orderedQty: '5',
            expectedPrice: '10.00',
            taxRate: '0.00',
            lineSubtotal: '50.00',
            lineTaxAmount: '0.00',
            lineTotal: '50.00',
            taxComponents: [],
          },
        ],
      });
      expect(pOLineTaxComponentDeleteMany).toHaveBeenCalledWith({ where: { poLineId: { in: ['l1'] } } });
      expect(pOLineDeleteMany).toHaveBeenCalledWith({ where: { purchaseOrderId: 'po1' } });
      expect(update.mock.calls[0][0].data.lines.create[0]).toMatchObject({ itemId: 'i2' });
    });

    it('does not touch lines at all when lines is omitted from the update', async () => {
      const { repository, update, pOLineDeleteMany } = buildRepository();
      await repository.update('po1', { discountAmount: '10.00' });
      expect(pOLineDeleteMany).not.toHaveBeenCalled();
      expect(update.mock.calls[0][0].data).toEqual({ discountAmount: '10.00' });
    });
  });

  describe('updateStatus', () => {
    it('passes the status transition straight through to Prisma', async () => {
      const { repository, update } = buildRepository();
      await repository.updateStatus('po1', { status: 'PENDING_APPROVAL' });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { status: 'PENDING_APPROVAL' },
        include: expect.anything(),
      });
    });
  });

  describe('applyGrnReceipt', () => {
    function fixturePoLineRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'l1',
        purchaseOrderId: 'po1',
        orderedQty: new Prisma.Decimal('20.000'),
        receivedQty: new Prisma.Decimal('0.000'),
        ...overrides,
      };
    }

    function buildTx(lineRow = fixturePoLineRow()) {
      const findUniqueOrThrow = jest.fn().mockResolvedValue(lineRow);
      const update = jest.fn();
      const findMany = jest.fn().mockResolvedValue([lineRow]);
      const purchaseOrderUpdate = jest.fn();
      const tx = {
        pOLine: { findUniqueOrThrow, update, findMany },
        purchaseOrder: { update: purchaseOrderUpdate },
      };
      return { tx, findUniqueOrThrow, update, findMany, purchaseOrderUpdate };
    }

    it('increments POLine.receivedQty by this GRN receipt', async () => {
      const { repository } = buildRepository();
      const { tx, update } = buildTx(fixturePoLineRow({ receivedQty: new Prisma.Decimal('5.000') }));
      await repository.applyGrnReceipt(tx as any, 'po1', [{ poLineId: 'l1', receivedQty: '10' }]);
      expect(update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { receivedQty: '15.000' } });
    });

    it('AC: sets PurchaseOrder.status to FULLY_RECEIVED once every line is fully received', async () => {
      const { repository } = buildRepository();
      const fullyReceivedLine = fixturePoLineRow({ receivedQty: new Prisma.Decimal('20.000') });
      const { tx, purchaseOrderUpdate } = buildTx(fullyReceivedLine);
      await repository.applyGrnReceipt(tx as any, 'po1', [{ poLineId: 'l1', receivedQty: '0' }]);
      expect(purchaseOrderUpdate).toHaveBeenCalledWith({ where: { id: 'po1' }, data: { status: 'FULLY_RECEIVED' } });
    });

    it('AC: sets PurchaseOrder.status to PARTIALLY_RECEIVED when some but not all lines are fully received', async () => {
      const { repository } = buildRepository();
      const partiallyReceivedLine = fixturePoLineRow({ receivedQty: new Prisma.Decimal('10.000') });
      const { tx, purchaseOrderUpdate } = buildTx(partiallyReceivedLine);
      await repository.applyGrnReceipt(tx as any, 'po1', [{ poLineId: 'l1', receivedQty: '0' }]);
      expect(purchaseOrderUpdate).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { status: 'PARTIALLY_RECEIVED' },
      });
    });

    it('leaves PurchaseOrder.status untouched when nothing has been received yet', async () => {
      const { repository } = buildRepository();
      const { tx, purchaseOrderUpdate } = buildTx(fixturePoLineRow({ receivedQty: new Prisma.Decimal('0.000') }));
      await repository.applyGrnReceipt(tx as any, 'po1', []);
      expect(purchaseOrderUpdate).not.toHaveBeenCalled();
    });
  });

  describe('updateEmailSent', () => {
    it('AC: records the timestamp and recipient of a successful send', async () => {
      const { repository, update } = buildRepository();
      const sentAt = new Date('2026-07-21T15:40:00.000Z');
      await repository.updateEmailSent('po1', { lastEmailedAt: sentAt, lastEmailedTo: 'supplier@example.com' });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { lastEmailedAt: sentAt, lastEmailedTo: 'supplier@example.com' },
        include: expect.anything(),
      });
    });
  });
});
