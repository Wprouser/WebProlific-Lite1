import { PrismaItemRepository } from './prisma-item.repository';

function fixturePrismaItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    barcode: null,
    unitId: 'u1',
    minStock: { toFixed: () => '10' },
    maxStock: { toFixed: () => '100' },
    currentStock: { toFixed: () => '0' },
    shelfLifeDays: 365,
    costPrice: { toFixed: () => '85.50' },
    defaultSupplierId: null,
    storageLocation: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PrismaItemRepository', () => {
  function buildRepository(items: ReturnType<typeof fixturePrismaItem>[] = []) {
    const findMany = jest.fn().mockResolvedValue(items);
    const prisma = { item: { findMany, create: jest.fn(), update: jest.fn() } };
    const repository = new PrismaItemRepository(prisma as any);
    return { repository, findMany };
  }

  it('returns no results (and does not query) when the caller has no accessible outlets', async () => {
    const { repository, findMany } = buildRepository();
    const result = await repository.findScoped({ accessibleOutletIds: [] });
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes to the accessible outlet set, narrowed by an explicit outletId filter', async () => {
    const { repository, findMany } = buildRepository();
    await repository.findScoped({ accessibleOutletIds: ['o1', 'o2'], outletId: 'o1' });
    expect(findMany.mock.calls[0][0].where.outletId).toBe('o1');
  });

  it('search matches against both name and sku', async () => {
    const { repository, findMany } = buildRepository();
    await repository.findScoped({ accessibleOutletIds: ['o1'], search: 'rice' });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'rice' } },
      { sku: { contains: 'rice' } },
    ]);
  });

  it('AC: belowMinStock=true returns only items where currentStock < minStock', async () => {
    const { repository } = buildRepository([
      fixturePrismaItem({ id: 'below', currentStock: { toFixed: () => '5' }, minStock: { toFixed: () => '10' } }),
      fixturePrismaItem({ id: 'above', currentStock: { toFixed: () => '50' }, minStock: { toFixed: () => '10' } }),
      fixturePrismaItem({ id: 'equal', currentStock: { toFixed: () => '10' }, minStock: { toFixed: () => '10' } }),
    ]);

    const result = await repository.findScoped({ accessibleOutletIds: ['o1'], belowMinStock: true });

    expect(result.map((i) => i.id)).toEqual(['below']);
  });

  it('belowMinStock=false (default) returns every scoped item regardless of stock level', async () => {
    const { repository } = buildRepository([
      fixturePrismaItem({ id: 'below', currentStock: { toFixed: () => '5' }, minStock: { toFixed: () => '10' } }),
      fixturePrismaItem({ id: 'above', currentStock: { toFixed: () => '50' }, minStock: { toFixed: () => '10' } }),
    ]);

    const result = await repository.findScoped({ accessibleOutletIds: ['o1'] });

    expect(result.map((i) => i.id).sort()).toEqual(['above', 'below']);
  });

  it('Decimal fields are serialized to strings, not left as Prisma.Decimal objects', async () => {
    const { repository } = buildRepository([fixturePrismaItem()]);
    const [item] = await repository.findScoped({ accessibleOutletIds: ['o1'] });
    expect(item!.minStock).toBe('10');
    expect(item!.costPrice).toBe('85.50');
  });

  describe('create', () => {
    const baseData = {
      outletId: 'o1',
      name: 'Basmati Rice',
      categoryId: 'c1',
      sku: 'RICE-BAS-001',
      unitId: 'u1',
      minStock: '10',
      maxStock: '100',
      costPrice: '85.50',
      performedById: 'u1',
    };

    it('creates directly (no transaction) when no openingStock is given', async () => {
      const created = fixturePrismaItem();
      const create = jest.fn().mockResolvedValue(created);
      const $transaction = jest.fn();
      const prisma = { item: { create }, $transaction };
      const repository = new PrismaItemRepository(prisma as any);

      await repository.create(baseData);

      expect($transaction).not.toHaveBeenCalled();
      const [[callArgs]] = create.mock.calls;
      expect(callArgs.data.performedById).toBeUndefined();
      expect(callArgs.data.openingStock).toBeUndefined();
    });

    it('AC: openingStock produces a real OPENING_BALANCE StockTransaction, not a raw currentStock write', async () => {
      // Duck-typed Prisma.Decimal — mirrors
      // prisma-stock-transaction.repository.spec.ts's fixture so
      // applyStockTransaction's real `new Prisma.Decimal(...).mul()` /
      // `.plus()` call chain against this mock behaves the same way.
      const createdItem = fixturePrismaItem({
        currentStock: {
          toFixed: () => '0.000',
          plus: (delta: { toString(): string }) => ({
            toFixed: (n: number) => Number(delta.toString()).toFixed(n),
            lessThan: (n: number) => Number(delta.toString()) < n,
          }),
        },
      });

      const itemCreate = jest.fn().mockResolvedValue(createdItem);
      const itemUpdate = jest.fn();
      const stockTransactionCreate = jest.fn().mockImplementation(({ data }: any) => ({ ...data }));
      const tx = {
        item: { create: itemCreate, update: itemUpdate },
        stockTransaction: { create: stockTransactionCreate },
      };
      const $transaction = jest.fn().mockImplementation((fn: any) => fn(tx));
      const prisma = { $transaction };
      const repository = new PrismaItemRepository(prisma as any);

      await repository.create({
        ...baseData,
        openingStock: { quantity: '25.000', ratePerUnit: '85.50' },
      });

      expect($transaction).toHaveBeenCalled();
      expect(stockTransactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'OPENING_BALANCE',
            quantity: '25.000',
            balanceAfter: '25.000',
            performedById: 'u1',
          }),
        }),
      );
      expect(itemUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentStock: '25.000' } }),
      );
    });
  });
});
