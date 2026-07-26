import { PrismaCurrencyRepository } from './prisma-currency.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2, ...overrides };
}

describe('PrismaCurrencyRepository', () => {
  function buildRepository() {
    const findMany = jest.fn().mockResolvedValue([fixtureRow()]);
    const findUnique = jest.fn().mockResolvedValue(fixtureRow());
    const create = jest.fn().mockResolvedValue(fixtureRow({ code: 'USD', name: 'US Dollar', symbol: '$' }));
    const prisma = { currency: { findMany, findUnique, create } };
    const repository = new PrismaCurrencyRepository(prisma as any);
    return { repository, findMany, findUnique, create };
  }

  it('findAll maps rows to the domain shape, ordered by code', async () => {
    const { repository, findMany } = buildRepository();
    const result = await repository.findAll();
    expect(findMany).toHaveBeenCalledWith({ orderBy: { code: 'asc' } });
    expect(result).toEqual([{ code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 }]);
  });

  it('findByCode returns null when not found', async () => {
    const prisma = { currency: { findUnique: jest.fn().mockResolvedValue(null) } };
    const repository = new PrismaCurrencyRepository(prisma as any);
    expect(await repository.findByCode('XXX')).toBeNull();
  });

  it('create passes the currency straight through to Prisma', async () => {
    const { repository, create } = buildRepository();
    const result = await repository.create({ code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 });
    expect(create).toHaveBeenCalledWith({ data: { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 } });
    expect(result.code).toBe('USD');
  });
});
