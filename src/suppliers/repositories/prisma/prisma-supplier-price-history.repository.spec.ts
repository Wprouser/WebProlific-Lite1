import { PrismaSupplierPriceHistoryRepository } from './prisma-supplier-price-history.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    supplierId: 's1',
    itemId: 'i1',
    price: { toFixed: () => '87.00' },
    currencyCode: 'SAR',
    priceInBaseCurrency: { toFixed: () => '87.00' },
    recordedAt: new Date('2026-01-01'),
    source: 'GRN',
    ...overrides,
  };
}

describe('PrismaSupplierPriceHistoryRepository', () => {
  function buildRepository(rows: ReturnType<typeof fixtureRow>[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { supplierPriceHistory: { findMany } };
    const repository = new PrismaSupplierPriceHistoryRepository(prisma as any);
    return { repository, findMany };
  }

  it('scopes to the given supplierId, most recent first', async () => {
    const { repository, findMany } = buildRepository();
    await repository.findScoped({ supplierId: 's1' });
    expect(findMany).toHaveBeenCalledWith({
      where: { supplierId: 's1' },
      orderBy: { recordedAt: 'desc' },
    });
  });

  it('narrows to a specific itemId when given', async () => {
    const { repository, findMany } = buildRepository();
    await repository.findScoped({ supplierId: 's1', itemId: 'i1' });
    expect(findMany.mock.calls[0][0].where).toEqual({ supplierId: 's1', itemId: 'i1' });
  });

  it('Decimal price is serialized to a fixed-precision string', async () => {
    const { repository } = buildRepository([fixtureRow()]);
    const [row] = await repository.findScoped({ supplierId: 's1' });
    expect(row!.price).toBe('87.00');
  });

  it('Decimal priceInBaseCurrency is serialized to a fixed-precision string', async () => {
    const { repository } = buildRepository([fixtureRow()]);
    const [row] = await repository.findScoped({ supplierId: 's1' });
    expect(row!.priceInBaseCurrency).toBe('87.00');
  });

  it('priceInBaseCurrency is null for a row recorded before this column existed', async () => {
    const { repository } = buildRepository([fixtureRow({ priceInBaseCurrency: null })]);
    const [row] = await repository.findScoped({ supplierId: 's1' });
    expect(row!.priceInBaseCurrency).toBeNull();
  });
});
