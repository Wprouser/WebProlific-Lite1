import { PrismaSupplierRepository } from './prisma-supplier.repository';

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    outletId: 'o1',
    supplierCode: 'SUP-001',
    name: 'Al-Fahad Trading',
    contactPerson: null,
    phone: null,
    email: null,
    addressLine: null,
    city: null,
    stateOrProvince: null,
    countryCode: null,
    postalCode: null,
    preferredCurrency: 'SAR',
    taxRegistrationType: null,
    taxRegistrationNumber: null,
    paymentTerms: null,
    leadTimeDays: null,
    bankAccountName: null,
    bankAccountNumber: null,
    bankIfscOrSwift: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PrismaSupplierRepository', () => {
  function buildRepository(rows: ReturnType<typeof fixtureRow>[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const findUnique = jest.fn();
    const create = jest.fn().mockImplementation(({ data }: any) => fixtureRow(data));
    const update = jest.fn().mockImplementation(({ data }: any) => fixtureRow(data));
    const prisma = { supplier: { findMany, findUnique, create, update } };
    const repository = new PrismaSupplierRepository(prisma as any);
    return { repository, findMany, findUnique, create, update };
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

    it('search matches against both name and supplierCode', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], search: 'fahad' });
      expect(findMany.mock.calls[0][0].where.OR).toEqual([
        { name: { contains: 'fahad' } },
        { supplierCode: { contains: 'fahad' } },
      ]);
    });

    it('filters to isActive when explicitly requested', async () => {
      const { repository, findMany } = buildRepository();
      await repository.findScoped({ accessibleOutletIds: ['o1'], isActive: true });
      expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
    });

    it('AC: no Decimal fields to serialize — Supplier is a plain pass-through mapping', async () => {
      const fixture = fixtureRow();
      const { repository } = buildRepository([fixture]);
      const [row] = await repository.findScoped({ accessibleOutletIds: ['o1'] });
      expect(row).toEqual(fixture);
    });
  });

  describe('create', () => {
    it('passes the full supplier payload straight through to Prisma', async () => {
      const { repository, create } = buildRepository();
      await repository.create({
        outletId: 'o1',
        name: 'Al-Fahad Trading',
        preferredCurrency: 'SAR',
        taxRegistrationType: 'VAT Reg. No.',
        taxRegistrationNumber: '3001234567',
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          outletId: 'o1',
          name: 'Al-Fahad Trading',
          preferredCurrency: 'SAR',
          taxRegistrationType: 'VAT Reg. No.',
          taxRegistrationNumber: '3001234567',
        },
      });
    });
  });

  describe('update', () => {
    it('passes partial updates straight through to Prisma', async () => {
      const { repository, update } = buildRepository();
      await repository.update('s1', { isActive: false });
      expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isActive: false } });
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      const { repository, findUnique } = buildRepository();
      findUnique.mockResolvedValue(null);
      expect(await repository.findById('missing')).toBeNull();
    });
  });
});
