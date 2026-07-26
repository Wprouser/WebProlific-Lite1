import { PrismaTaxRateRepository } from './prisma-tax-rate.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    outletId: 'o1',
    name: 'VAT 15%',
    ratePercent: { toFixed: () => '15.00' },
    isCompound: false,
    isDefault: false,
    isActive: true,
    countryCode: 'SA',
    createdAt: new Date(),
    updatedAt: new Date(),
    components: [],
    ...overrides,
  };
}

function fixtureComponentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    taxRateId: 't1',
    componentName: 'CGST',
    componentRate: { toFixed: () => '9.00' },
    sortOrder: 0,
    ...overrides,
  };
}

describe('PrismaTaxRateRepository', () => {
  function buildRepository(rows: ReturnType<typeof fixtureRow>[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const findUnique = jest.fn();
    const create = jest.fn().mockImplementation(({ data }: any) =>
      fixtureRow({
        ...data,
        ratePercent: { toFixed: () => data.ratePercent },
        components: (data.components?.create ?? []).map((c: any, i: number) =>
          fixtureComponentRow({ id: `new-${i}`, ...c, componentRate: { toFixed: () => c.componentRate } }),
        ),
      }),
    );
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const update = jest.fn().mockImplementation(({ data }: any) =>
      fixtureRow({
        ...data,
        ratePercent: { toFixed: () => data.ratePercent ?? '15.00' },
        components: (data.components?.create ?? []).map((c: any, i: number) =>
          fixtureComponentRow({ id: `new-${i}`, ...c, componentRate: { toFixed: () => c.componentRate } }),
        ),
      }),
    );
    const prisma = {
      taxRate: { findMany, findUnique, create, update },
      taxRateComponent: { deleteMany },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({ taxRate: { update }, taxRateComponent: { deleteMany } }),
      ),
    };
    const repository = new PrismaTaxRateRepository(prisma as any);
    return { repository, findMany, findUnique, create, update, deleteMany };
  }

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

    it('AC: omitting isActive returns both active and inactive rows (no filter applied)', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'] });
      expect(findMany.mock.calls[0][0].where.isActive).toBeUndefined();
    });

    it('filters to isActive: true when explicitly requested', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], isActive: true });
      expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
    });

    it('filters to isActive: false when explicitly requested', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], isActive: false });
      expect(findMany.mock.calls[0][0].where.isActive).toBe(false);
    });

    it('Decimal ratePercent is serialized to a fixed-precision string', async () => {
      const { repository } = buildRepository([fixtureRow()]);
      const [row] = await repository.findScoped({ accessibleOutletIds: ['o1'] });
      expect(row!.ratePercent).toBe('15.00');
    });

    it('includes and serializes components', async () => {
      const { repository } = buildRepository([
        fixtureRow({ isCompound: true, components: [fixtureComponentRow()] }),
      ]);
      const [row] = await repository.findScoped({ accessibleOutletIds: ['o1'] });
      expect(row!.components).toEqual([
        { id: 'c1', taxRateId: 't1', componentName: 'CGST', componentRate: '9.00', sortOrder: 0 },
      ]);
    });
  });

  describe('create', () => {
    it('passes simple-rate data straight through to prisma.taxRate.create, no nested components', async () => {
      const { repository, create } = buildRepository();
      await repository.create({ outletId: 'o1', name: 'Zero-Rated', ratePercent: '0.00' });
      expect(create).toHaveBeenCalledWith({
        data: { outletId: 'o1', name: 'Zero-Rated', ratePercent: '0.00' },
        include: { components: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      });
    });

    it('AC: creates nested components for a compound rate', async () => {
      const { repository, create } = buildRepository();
      await repository.create({
        outletId: 'o1',
        name: 'GST 18% (Intra-state)',
        ratePercent: '18.00',
        isCompound: true,
        components: [
          { componentName: 'CGST', componentRate: '9.00' },
          { componentName: 'SGST', componentRate: '9.00' },
        ],
      });
      expect(create.mock.calls[0][0].data.components).toEqual({
        create: [
          { componentName: 'CGST', componentRate: '9.00', sortOrder: 0 },
          { componentName: 'SGST', componentRate: '9.00', sortOrder: 1 },
        ],
      });
    });

    it('AC: sortOrder always matches array position, never a random/derived value — the fix for a real flaky-order bug', async () => {
      const { repository, create } = buildRepository();
      await repository.create({
        outletId: 'o1',
        name: 'GST 18% (Inter-state then more)',
        ratePercent: '27.00',
        isCompound: true,
        components: [
          { componentName: 'IGST', componentRate: '9.00' },
          { componentName: 'X', componentRate: '9.00' },
          { componentName: 'Y', componentRate: '9.00' },
        ],
      });
      const sent = create.mock.calls[0][0].data.components.create;
      expect(sent.map((c: { sortOrder: number }) => c.sortOrder)).toEqual([0, 1, 2]);
    });

    it('serializes the created row the same way findScoped does', async () => {
      const create = jest.fn().mockResolvedValue(fixtureRow({ name: 'Zero-Rated', ratePercent: { toFixed: () => '0.00' } }));
      const prisma = { taxRate: { create, findMany: jest.fn() } };
      const repository = new PrismaTaxRateRepository(prisma as any);

      const result = await repository.create({ outletId: 'o1', name: 'Zero-Rated', ratePercent: '0.00' });

      expect(result.ratePercent).toBe('0.00');
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      const { repository, findUnique } = buildRepository();
      findUnique.mockResolvedValue(null);
      const result = await repository.findById('missing');
      expect(result).toBeNull();
    });

    it('returns the serialized row when found', async () => {
      const { repository, findUnique } = buildRepository();
      findUnique.mockResolvedValue(fixtureRow());
      const result = await repository.findById('t1');
      expect(result?.id).toBe('t1');
      expect(result?.ratePercent).toBe('15.00');
    });
  });

  describe('update', () => {
    it('passes data straight through to prisma.taxRate.update when no components given', async () => {
      const { repository, update, deleteMany } = buildRepository();
      await repository.update('t1', { isActive: false });
      expect(update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: false },
        include: { components: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      });
      // No components touched at all for a plain field update.
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('AC: replaces components wholesale (delete then recreate) when components are provided', async () => {
      const { repository, update, deleteMany } = buildRepository();
      await repository.update('t1', {
        components: [
          { componentName: 'CGST', componentRate: '9.00' },
          { componentName: 'SGST', componentRate: '9.00' },
        ],
      });
      expect(deleteMany).toHaveBeenCalledWith({ where: { taxRateId: 't1' } });
      expect(update.mock.calls[0][0].data.components).toEqual({
        create: [
          { componentName: 'CGST', componentRate: '9.00', sortOrder: 0 },
          { componentName: 'SGST', componentRate: '9.00', sortOrder: 1 },
        ],
      });
    });

    it('clearing components (empty array) still deletes existing ones without creating new rows', async () => {
      const { repository, update, deleteMany } = buildRepository();
      await repository.update('t1', { isCompound: false, components: [] });
      expect(deleteMany).toHaveBeenCalledWith({ where: { taxRateId: 't1' } });
      expect(update.mock.calls[0][0].data.components).toEqual({ create: [] });
    });
  });
});
