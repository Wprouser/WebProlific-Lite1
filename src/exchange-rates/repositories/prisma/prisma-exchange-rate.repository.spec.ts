import { PrismaExchangeRateRepository } from './prisma-exchange-rate.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    baseCurrency: 'SAR',
    targetCurrency: 'USD',
    rate: { toFixed: (n: number) => (3.75).toFixed(n) },
    effectiveDate: new Date('2026-01-01'),
    source: 'MANUAL',
    ...overrides,
  };
}

describe('PrismaExchangeRateRepository', () => {
  function buildRepository(rows: ReturnType<typeof fixtureRow>[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const create = jest.fn().mockResolvedValue(fixtureRow());
    const prisma = { exchangeRate: { findMany, create } };
    const repository = new PrismaExchangeRateRepository(prisma as any);
    return { repository, findMany, create };
  }

  it('create passes baseCurrency/targetCurrency/rate/source straight to Prisma', async () => {
    const { repository, create } = buildRepository();
    await repository.create({ baseCurrency: 'SAR', targetCurrency: 'USD', rate: '3.750000', source: 'MANUAL' });
    expect(create).toHaveBeenCalledWith({
      data: { baseCurrency: 'SAR', targetCurrency: 'USD', rate: '3.750000', source: 'MANUAL' },
    });
  });

  it('rate is serialized to a fixed 6-decimal-place string, not left as a Prisma.Decimal object', async () => {
    const { repository } = buildRepository([fixtureRow()]);
    const [row] = await repository.findLatestPerPair({});
    expect(row!.rate).toBe('3.750000');
  });

  it('findLatestPerPair orders by effectiveDate desc and applies distinct on the pair, so the newest row per pair wins', async () => {
    const { repository, findMany } = buildRepository([fixtureRow()]);
    await repository.findLatestPerPair({ baseCurrency: 'SAR' });
    expect(findMany).toHaveBeenCalledWith({
      where: { baseCurrency: 'SAR' },
      orderBy: { effectiveDate: 'desc' },
      distinct: ['baseCurrency', 'targetCurrency'],
    });
  });

  it('applies both filters when a specific pair is requested', async () => {
    const { repository, findMany } = buildRepository([fixtureRow()]);
    await repository.findLatestPerPair({ baseCurrency: 'SAR', targetCurrency: 'USD' });
    expect(findMany).toHaveBeenCalledWith({
      where: { baseCurrency: 'SAR', targetCurrency: 'USD' },
      orderBy: { effectiveDate: 'desc' },
      distinct: ['baseCurrency', 'targetCurrency'],
    });
  });
});
