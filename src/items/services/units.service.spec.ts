import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitOfMeasureRepository } from '../repositories/unit-of-measure.repository';
import { UnitOfMeasure } from '../domain/unit-of-measure.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureRequest(role: string | null = 'OUTLET_MANAGER'): RequestWithAccess {
  return {
    user: { id: 'u1' },
    effectiveAccess: {
      userId: 'u1',
      effectiveOutletIds: ['o1'],
      effectivePropertyIds: [],
      effectiveChainIds: [],
      effectiveRole: role as never,
      grants: [],
      roleForChain: () => undefined,
      roleForProperty: () => undefined,
      roleForOutlet: () => role as never,
    },
  } as unknown as RequestWithAccess;
}

function fixtureUnit(overrides: Partial<UnitOfMeasure> = {}): UnitOfMeasure {
  return {
    id: 'u1',
    outletId: 'o1',
    name: 'Kilogram',
    abbreviation: 'kg',
    baseUnitId: null,
    conversionFactor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UnitsService', () => {
  function buildService(existing: UnitOfMeasure = fixtureUnit(), byId: Record<string, UnitOfMeasure | null> = {}) {
    const unitRepository: Partial<UnitOfMeasureRepository> = {
      create: jest.fn().mockResolvedValue(existing),
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(id in byId ? byId[id] : existing),
      ),
      findByNameAndOutlet: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ ...existing, isActive: false }),
      findScoped: jest.fn().mockResolvedValue([existing]),
      findByBaseUnitId: jest.fn().mockResolvedValue([]),
    };
    const service = new UnitsService(unitRepository as UnitOfMeasureRepository);
    return { service, unitRepository };
  }

  const createDto = { outletId: 'o1', name: 'Bunch', abbreviation: 'bunch' };

  it('creates for OUTLET_MANAGER', async () => {
    const { service, unitRepository } = buildService();
    await service.create(fixtureRequest('OUTLET_MANAGER'), createDto);
    expect(unitRepository.create).toHaveBeenCalledWith(createDto);
  });

  it('rejects STORE_STAFF', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest('STORE_STAFF'), createDto)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a caller with no access to the target outlet', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest(null), createDto)).rejects.toThrow(ForbiddenException);
  });

  it('AC: rejects a duplicate name within the same outlet', async () => {
    const { service, unitRepository } = buildService();
    (unitRepository.findByNameAndOutlet as jest.Mock).mockResolvedValue(fixtureUnit());
    await expect(service.create(fixtureRequest(), createDto)).rejects.toThrow(ConflictException);
  });

  it('update edits name/abbreviation', async () => {
    const { service, unitRepository } = buildService();
    await service.update(fixtureRequest(), 'u1', { name: 'Bunch (herbs)' });
    expect(unitRepository.update).toHaveBeenCalledWith('u1', { name: 'Bunch (herbs)' });
  });

  it('update throws NotFoundException for a missing unit', async () => {
    const { service, unitRepository } = buildService();
    (unitRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.update(fixtureRequest(), 'missing', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('AC: deactivate soft-deactivates only (isActive: false), never removes the row', async () => {
    const { service, unitRepository } = buildService();
    const result = await service.deactivate(fixtureRequest(), 'u1');
    expect(unitRepository.update).toHaveBeenCalledWith('u1', { isActive: false });
    expect(result.isActive).toBe(false);
  });

  it('list scopes to the caller\'s accessible outlets', async () => {
    const { service, unitRepository } = buildService();
    await service.list(fixtureRequest(), { outletId: 'o1', isActive: 'true' });
    expect(unitRepository.findScoped).toHaveBeenCalledWith({
      accessibleOutletIds: ['o1'],
      outletId: 'o1',
      isActive: true,
    });
  });

  describe('conversion validation', () => {
    const millilitre = fixtureUnit({ id: 'ml', name: 'Millilitre', abbreviation: 'mL', baseUnitId: null, conversionFactor: null });

    it('AC: creates a derived unit pointing to a genuine base unit', async () => {
      const { service, unitRepository } = buildService(fixtureUnit(), { ml: millilitre });
      const dto = { outletId: 'o1', name: 'Litre', abbreviation: 'L', baseUnitId: 'ml', conversionFactor: '1000' };
      await service.create(fixtureRequest(), dto);
      expect(unitRepository.create).toHaveBeenCalledWith(dto);
    });

    it('rejects conversionFactor set without a baseUnitId', async () => {
      const { service } = buildService();
      await expect(
        service.create(fixtureRequest(), { ...createDto, conversionFactor: '1000' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects baseUnitId set with no (or non-positive) conversionFactor', async () => {
      const { service } = buildService(fixtureUnit(), { ml: millilitre });
      await expect(
        service.create(fixtureRequest(), { ...createDto, baseUnitId: 'ml' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(fixtureRequest(), { ...createDto, baseUnitId: 'ml', conversionFactor: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a baseUnitId that does not exist', async () => {
      const { service } = buildService(fixtureUnit(), { missing: null });
      await expect(
        service.create(fixtureRequest(), { ...createDto, baseUnitId: 'missing', conversionFactor: '1000' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a baseUnitId belonging to a different outlet', async () => {
      const otherOutletUnit = fixtureUnit({ id: 'ml2', outletId: 'o2', baseUnitId: null });
      const { service } = buildService(fixtureUnit(), { ml2: otherOutletUnit });
      await expect(
        service.create(fixtureRequest(), { ...createDto, baseUnitId: 'ml2', conversionFactor: '1000' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC: rejects a baseUnitId that points to another derived unit (flat, two-level hierarchy only)', async () => {
      const litre = fixtureUnit({ id: 'l', name: 'Litre', baseUnitId: 'ml', conversionFactor: '1000' });
      const { service } = buildService(fixtureUnit(), { l: litre });
      await expect(
        service.create(fixtureRequest(), { ...createDto, baseUnitId: 'l', conversionFactor: '2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a unit being set as its own base unit', async () => {
      const { service } = buildService(fixtureUnit({ id: 'u1', baseUnitId: null }));
      await expect(
        service.update(fixtureRequest(), 'u1', { baseUnitId: 'u1', conversionFactor: '1000' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC: rejects re-parenting a unit that already has derived units pointing to it', async () => {
      const gram = fixtureUnit({ id: 'g', name: 'Gram', baseUnitId: null });
      const { service, unitRepository } = buildService(gram, { ml: millilitre });
      (unitRepository.findByBaseUnitId as jest.Mock).mockResolvedValue([
        fixtureUnit({ id: 'kg', name: 'Kilogram', baseUnitId: 'g', conversionFactor: '1000' }),
      ]);
      await expect(
        service.update(fixtureRequest(), 'g', { baseUnitId: 'ml', conversionFactor: '1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('update can clear an existing conversion relationship by setting both fields to null', async () => {
      const litre = fixtureUnit({ id: 'l', name: 'Litre', baseUnitId: 'ml', conversionFactor: '1000' });
      const { service, unitRepository } = buildService(litre);
      await service.update(fixtureRequest(), 'l', { baseUnitId: null, conversionFactor: null });
      expect(unitRepository.update).toHaveBeenCalledWith('l', { baseUnitId: null, conversionFactor: null });
    });
  });
});
