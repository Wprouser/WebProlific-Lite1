import { PrismaUnitOfMeasureRepository } from './prisma-unit-of-measure.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    outletId: 'o1',
    name: 'Kilogram',
    abbreviation: 'kg',
    baseUnitId: null,
    conversionFactor: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('PrismaUnitOfMeasureRepository', () => {
  function buildRepository() {
    const create = jest.fn();
    const findUnique = jest.fn();
    const update = jest.fn();
    const findMany = jest.fn();
    const prisma = { unitOfMeasure: { create, findUnique, update, findMany } };
    const repository = new PrismaUnitOfMeasureRepository(prisma as any);
    return { repository, create, findUnique, update, findMany };
  }

  it('creates a unit scoped to the given outlet', async () => {
    const { repository, create } = buildRepository();
    create.mockResolvedValue(fixtureRow());
    await repository.create({ outletId: 'o1', name: 'Kilogram', abbreviation: 'kg' });
    expect(create).toHaveBeenCalledWith({ data: { outletId: 'o1', name: 'Kilogram', abbreviation: 'kg' } });
  });

  it('creates a derived unit with baseUnitId/conversionFactor passed straight through', async () => {
    const { repository, create } = buildRepository();
    create.mockResolvedValue(fixtureRow({ name: 'Litre', abbreviation: 'L', baseUnitId: 'ml', conversionFactor: { toFixed: () => '1000.000000' } }));
    await repository.create({ outletId: 'o1', name: 'Litre', abbreviation: 'L', baseUnitId: 'ml', conversionFactor: '1000' });
    expect(create).toHaveBeenCalledWith({
      data: { outletId: 'o1', name: 'Litre', abbreviation: 'L', baseUnitId: 'ml', conversionFactor: '1000' },
    });
  });

  it('findById returns null for a missing row', async () => {
    const { repository, findUnique } = buildRepository();
    findUnique.mockResolvedValue(null);
    expect(await repository.findById('missing')).toBeNull();
  });

  it('findByNameAndOutlet looks up via the compound unique key', async () => {
    const { repository, findUnique } = buildRepository();
    findUnique.mockResolvedValue(fixtureRow());
    await repository.findByNameAndOutlet('Kilogram', 'o1');
    expect(findUnique).toHaveBeenCalledWith({ where: { name_outletId: { name: 'Kilogram', outletId: 'o1' } } });
  });

  it('AC: update can deactivate (isActive: false) without deleting the row', async () => {
    const { repository, update } = buildRepository();
    update.mockResolvedValue(fixtureRow({ isActive: false }));
    const result = await repository.update('u1', { isActive: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(result.isActive).toBe(false);
  });

  it('update can clear an existing conversion relationship (both fields set to null)', async () => {
    const { repository, update } = buildRepository();
    update.mockResolvedValue(fixtureRow({ name: 'Litre', baseUnitId: null, conversionFactor: null }));
    const result = await repository.update('l', { baseUnitId: null, conversionFactor: null });
    expect(update).toHaveBeenCalledWith({ where: { id: 'l' }, data: { baseUnitId: null, conversionFactor: null } });
    expect(result.baseUnitId).toBeNull();
    expect(result.conversionFactor).toBeNull();
  });

  it('Decimal conversionFactor is serialized to a fixed-6dp string; null stays null', async () => {
    const { repository, findUnique } = buildRepository();
    findUnique.mockResolvedValue(
      fixtureRow({ baseUnitId: 'ml', conversionFactor: { toFixed: (n: number) => Number('1000').toFixed(n) } }),
    );
    const row = await repository.findById('l');
    expect(row!.conversionFactor).toBe('1000.000000');

    findUnique.mockResolvedValue(fixtureRow());
    const baseRow = await repository.findById('ml');
    expect(baseRow!.conversionFactor).toBeNull();
  });

  it('findByBaseUnitId returns every unit currently pointing to the given unit as its base', async () => {
    const { repository, findMany } = buildRepository();
    findMany.mockResolvedValue([fixtureRow({ id: 'kg', name: 'Kilogram', baseUnitId: 'g' })]);
    const result = await repository.findByBaseUnitId('g');
    expect(findMany).toHaveBeenCalledWith({ where: { baseUnitId: 'g' } });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('kg');
  });

  it('findScoped filters by outlet and isActive, ordered by name', async () => {
    const { repository, findMany } = buildRepository();
    findMany.mockResolvedValue([fixtureRow()]);
    await repository.findScoped({ accessibleOutletIds: ['o1', 'o2'], outletId: 'o1', isActive: true });
    expect(findMany).toHaveBeenCalledWith({
      where: { outletId: 'o1', isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('findScoped returns [] when the caller has no accessible outlets', async () => {
    const { repository, findMany } = buildRepository();
    const result = await repository.findScoped({ accessibleOutletIds: [] });
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
