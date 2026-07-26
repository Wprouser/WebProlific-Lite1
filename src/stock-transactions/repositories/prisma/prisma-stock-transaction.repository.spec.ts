import { PrismaStockTransactionRepository } from './prisma-stock-transaction.repository';

function fixturePrismaTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    outletId: 'o1',
    itemId: 'i1',
    type: 'USAGE_OUT',
    quantity: { toFixed: () => '5.000' },
    balanceAfter: { toFixed: () => '37.000' },
    referenceType: null,
    referenceId: null,
    reasonCode: null,
    photoUrl: null,
    performedById: 'u1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PrismaStockTransactionRepository', () => {
  describe('findScoped', () => {
    function buildRepository(rows: ReturnType<typeof fixturePrismaTransaction>[] = []) {
      const findMany = jest.fn().mockResolvedValue(rows);
      const prisma = { stockTransaction: { findMany } };
      const repository = new PrismaStockTransactionRepository(prisma as any);
      return { repository, findMany };
    }

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

    it('Decimal fields are serialized to fixed-precision strings, not left as Prisma.Decimal objects', async () => {
      const { repository } = buildRepository([fixturePrismaTransaction()]);
      const [row] = await repository.findScoped({ accessibleOutletIds: ['o1'] });
      expect(row!.quantity).toBe('5.000');
      expect(row!.balanceAfter).toBe('37.000');
    });
  });

  describe('existsForOutlet', () => {
    it('returns true when at least one transaction row exists for the outlet', async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: 't1' });
      const prisma = { stockTransaction: { findFirst } };
      const repository = new PrismaStockTransactionRepository(prisma as any);

      expect(await repository.existsForOutlet('o1')).toBe(true);
      expect(findFirst).toHaveBeenCalledWith({ where: { outletId: 'o1' }, select: { id: true } });
    });

    it('returns false when the outlet has no transaction history at all', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const prisma = { stockTransaction: { findFirst } };
      const repository = new PrismaStockTransactionRepository(prisma as any);

      expect(await repository.existsForOutlet('o1')).toBe(false);
    });
  });

  describe('createWithBalanceUpdate', () => {
    function buildRepository(currentStock: string) {
      const item = {
        id: 'i1',
        outletId: 'o1',
        minStock: { toFixed: () => '10.000' },
        currentStock: {
          toFixed: () => currentStock,
          plus: (delta: { toString(): string }) => ({
            toFixed: (n: number) => (Number(currentStock) + Number(delta.toString())).toFixed(n),
            lessThan: (n: number) => Number(currentStock) + Number(delta.toString()) < n,
          }),
        },
      };
      const tx = {
        item: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(item),
          update: jest.fn().mockImplementation(({ data }: any) => ({ ...item, currentStock: { toFixed: () => data.currentStock } })),
        },
        stockTransaction: {
          create: jest.fn().mockImplementation(({ data }: any) => ({ ...fixturePrismaTransaction(), ...data, quantity: { toFixed: () => data.quantity }, balanceAfter: { toFixed: () => data.balanceAfter } })),
        },
      };
      const $transaction = jest.fn().mockImplementation((fn: any) => fn(tx));
      const prisma = { $transaction };
      const repository = new PrismaStockTransactionRepository(prisma as any);
      return { repository, tx, $transaction };
    }

    it('AC: rejects a stock-out that would go negative when not overridden', async () => {
      const { repository } = buildRepository('2.000');
      const result = await repository.createWithBalanceUpdate({
        outletId: 'o1',
        itemId: 'i1',
        type: 'USAGE_OUT',
        quantity: '5.000',
        referenceType: null,
        referenceId: null,
        reasonCode: null,
        performedById: 'u1',
        allowNegativeBalance: false,
      });
      expect(result.ok).toBe(false);
    });

    it('allows a negative balance when allowNegativeBalance is true', async () => {
      const { repository, tx } = buildRepository('2.000');
      const result = await repository.createWithBalanceUpdate({
        outletId: 'o1',
        itemId: 'i1',
        type: 'USAGE_OUT',
        quantity: '5.000',
        referenceType: null,
        referenceId: null,
        reasonCode: null,
        performedById: 'u1',
        allowNegativeBalance: true,
      });
      expect(result.ok).toBe(true);
      expect(tx.stockTransaction.create).toHaveBeenCalled();
      expect(tx.item.update).toHaveBeenCalled();
    });

    it('runs inside a Serializable isolation transaction', async () => {
      const { repository, $transaction } = buildRepository('50.000');
      await repository.createWithBalanceUpdate({
        outletId: 'o1',
        itemId: 'i1',
        type: 'PURCHASE_IN',
        quantity: '10.000',
        referenceType: null,
        referenceId: null,
        reasonCode: null,
        performedById: 'u1',
        allowNegativeBalance: false,
      });
      expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    });
  });
});
