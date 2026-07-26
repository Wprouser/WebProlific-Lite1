import { Prisma } from '@prisma/client';
import { PrismaGrnRepository } from './prisma-grn.repository';
import { PurchaseOrderRepository } from '../../../purchase-orders/repositories/purchase-order.repository';

function fixtureLineTaxComponentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gc1',
    grnLineId: 'gl1',
    componentName: 'CGST',
    componentRate: { toFixed: () => '9.00' },
    componentAmount: { toFixed: () => '9.00' },
    sortOrder: 0,
    ...overrides,
  };
}

function fixtureLineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gl1',
    grnId: 'g1',
    itemId: 'i1',
    orderedQty: null,
    receivedQty: { toFixed: () => '5.000' },
    actualPrice: { toFixed: () => '92.00' },
    taxRateId: 't1',
    taxRate: { toFixed: () => '15.00' },
    lineSubtotal: { toFixed: () => '460.00' },
    lineTaxAmount: { toFixed: () => '69.00' },
    lineTotal: { toFixed: () => '529.00' },
    taxComponents: [],
    ...overrides,
  };
}

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    outletId: 'o1',
    purchaseOrderId: null,
    supplierId: 's1',
    receivedById: 'u1',
    receivedAt: new Date(),
    currencyCode: 'SAR',
    exchangeRateToBase: { toFixed: () => '1.000000' },
    isTaxInclusive: false,
    discountAmount: { toFixed: () => '0.00' },
    otherChargesAmount: { toFixed: () => '0.00' },
    subtotal: { toFixed: () => '460.00' },
    taxAmount: { toFixed: () => '69.00' },
    totalValue: { toFixed: () => '529.00' },
    invoiceNumber: null,
    invoiceScanUrl: null,
    invoiceScanStatus: null,
    varianceFlagged: false,
    lines: [fixtureLineRow()],
    lastEmailedAt: null,
    lastEmailedTo: null,
    ...overrides,
  };
}

describe('PrismaGrnRepository', () => {
  function buildRepository(row = fixtureRow(), itemRow: Record<string, unknown> = { currentStock: new Prisma.Decimal('10.000') }) {
    const gRNCreate = jest.fn().mockResolvedValue(row);
    const gRNFindUnique = jest.fn().mockResolvedValue(row);
    const gRNFindMany = jest.fn().mockResolvedValue([row]);
    const gRNUpdate = jest.fn().mockResolvedValue(row);
    const itemFindUniqueOrThrow = jest.fn().mockResolvedValue(itemRow);
    const stockTransactionCreate = jest.fn().mockResolvedValue({ id: 'st1', balanceAfter: { toFixed: () => '15.000' } });
    const itemUpdate = jest.fn();
    const supplierPriceHistoryCreate = jest.fn();
    const applyGrnReceipt = jest.fn();
    const poRepository: Partial<PurchaseOrderRepository> = { applyGrnReceipt };

    const txClient = {
      gRN: { create: gRNCreate },
      item: { findUniqueOrThrow: itemFindUniqueOrThrow, update: itemUpdate },
      stockTransaction: { create: stockTransactionCreate },
      supplierPriceHistory: { create: supplierPriceHistoryCreate },
    };
    const prisma = {
      gRN: { findUnique: gRNFindUnique, findMany: gRNFindMany, update: gRNUpdate },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(txClient)),
    };
    const repository = new PrismaGrnRepository(prisma as any, poRepository as PurchaseOrderRepository);
    return {
      repository,
      gRNCreate,
      gRNFindUnique,
      gRNFindMany,
      gRNUpdate,
      itemFindUniqueOrThrow,
      stockTransactionCreate,
      itemUpdate,
      supplierPriceHistoryCreate,
      applyGrnReceipt,
    };
  }

  const createInput = {
    outletId: 'o1',
    supplierId: 's1',
    receivedById: 'u1',
    currencyCode: 'SAR',
    exchangeRateToBase: '1',
    isTaxInclusive: false,
    discountAmount: '0.00',
    otherChargesAmount: '0.00',
    subtotal: '460.00',
    taxAmount: '69.00',
    totalValue: '529.00',
    varianceFlagged: false,
    lines: [
      {
        itemId: 'i1',
        receivedQty: '5',
        actualPrice: '92.00',
        taxRateId: 't1',
        taxRate: '15.00',
        lineSubtotal: '460.00',
        lineTaxAmount: '69.00',
        lineTotal: '529.00',
        taxComponents: [],
      },
    ],
  };

  describe('create', () => {
    it('AC: posts exactly one PURCHASE_IN StockTransaction per line', async () => {
      const { repository, stockTransactionCreate } = buildRepository();
      await repository.create(createInput);
      expect(stockTransactionCreate).toHaveBeenCalledTimes(1);
      expect(stockTransactionCreate.mock.calls[0][0].data).toMatchObject({
        itemId: 'i1',
        type: 'PURCHASE_IN',
        quantity: '5.000',
        referenceType: 'GRN',
        referenceId: 'g1',
      });
    });

    it('increases Item.currentStock by the received quantity', async () => {
      const { repository, itemUpdate } = buildRepository();
      await repository.create(createInput);
      // currentStock 10.000 + received 5.000 = 15.000
      expect(itemUpdate).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { currentStock: '15.000' } });
    });

    it('AC: records exactly one SupplierPriceHistory row per line, in the GRN currency', async () => {
      const { repository, supplierPriceHistoryCreate } = buildRepository();
      await repository.create(createInput);
      expect(supplierPriceHistoryCreate).toHaveBeenCalledTimes(1);
      expect(supplierPriceHistoryCreate.mock.calls[0][0].data).toMatchObject({
        supplierId: 's1',
        itemId: 'i1',
        price: '92.00',
        currencyCode: 'SAR',
        priceInBaseCurrency: '92.00',
        source: 'GRN',
      });
    });

    it('AC: SupplierPriceHistory.priceInBaseCurrency converts using the GRN\'s exchangeRateToBase, so cross-currency prices stay comparable', async () => {
      const { repository, supplierPriceHistoryCreate } = buildRepository();
      await repository.create({ ...createInput, currencyCode: 'EUR', exchangeRateToBase: '3.75' });
      expect(supplierPriceHistoryCreate.mock.calls[0][0].data).toMatchObject({
        price: '92.00',
        currencyCode: 'EUR',
        priceInBaseCurrency: '345.00',
      });
    });

    it('does not touch the linked PO when purchaseOrderId is absent (Direct GRN)', async () => {
      const { repository, applyGrnReceipt } = buildRepository();
      await repository.create(createInput);
      expect(applyGrnReceipt).not.toHaveBeenCalled();
    });

    it('AC: updates POLine.receivedQty and recomputes PO status when linked to a PO', async () => {
      const { repository, applyGrnReceipt } = buildRepository(
        fixtureRow({ purchaseOrderId: 'po1' }),
      );
      await repository.create({
        ...createInput,
        purchaseOrderId: 'po1',
        lines: [{ ...createInput.lines[0]!, poLineId: 'l1', orderedQty: '20' }],
      });
      expect(applyGrnReceipt).toHaveBeenCalledWith(expect.anything(), 'po1', [
        { poLineId: 'l1', receivedQty: '5' },
      ]);
    });

    it('serializes Decimal fields to fixed-precision strings', async () => {
      const { repository } = buildRepository();
      const result = await repository.create(createInput);
      expect(result.totalValue).toBe('529.00');
      expect(result.exchangeRateToBase).toBe('1.000000');
      expect(result.lines[0]!.receivedQty).toBe('5.000');
    });
  });

  describe('findScoped', () => {
    it('returns no results (and does not query) when the caller has no accessible outlets', async () => {
      const { repository, gRNFindMany } = buildRepository();
      const result = await repository.findScoped({ accessibleOutletIds: [] });
      expect(result).toEqual([]);
      expect(gRNFindMany).not.toHaveBeenCalled();
    });

    it('rejects an explicit outletId filter outside the accessible set', async () => {
      const { repository, gRNFindMany } = buildRepository();
      const result = await repository.findScoped({ accessibleOutletIds: ['o1'], outletId: 'o2' });
      expect(result).toEqual([]);
      expect(gRNFindMany).not.toHaveBeenCalled();
    });

    it('filters by supplierId and purchaseOrderId when given', async () => {
      const { repository, gRNFindMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], supplierId: 's1', purchaseOrderId: 'po1' });
      expect(gRNFindMany.mock.calls[0][0].where).toMatchObject({ supplierId: 's1', purchaseOrderId: 'po1' });
    });
  });

  describe('updateEmailSent', () => {
    it('AC: records the timestamp and recipient of a successful send', async () => {
      const { repository, gRNUpdate } = buildRepository();
      const sentAt = new Date('2026-07-21T15:40:00.000Z');
      await repository.updateEmailSent('g1', { lastEmailedAt: sentAt, lastEmailedTo: 'supplier@example.com' });
      expect(gRNUpdate).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { lastEmailedAt: sentAt, lastEmailedTo: 'supplier@example.com' },
        include: expect.anything(),
      });
    });
  });
});
