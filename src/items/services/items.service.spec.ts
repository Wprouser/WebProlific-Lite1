import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';
import { ItemRepository } from '../repositories/item.repository';
import { Item } from '../domain/item.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';

function fixtureItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    barcode: null,
    unitId: 'u1',
    minStock: '10',
    maxStock: '100',
    currentStock: '0',
    shelfLifeDays: 365,
    costPrice: '85.50',
    defaultSupplierId: null,
    purchaseGLAccount: null,
    defaultTaxRateId: null,
    storageLocation: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// `null` (not `undefined`) means "no role at this outlet" — a default
// parameter only substitutes for an omitted/`undefined` argument, so
// `fixtureRequest(undefined)` would silently fall through to the default
// role instead of testing the no-access case.
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

describe('ItemsService', () => {
  function buildService(item = fixtureItem()) {
    const itemRepository: Partial<ItemRepository> = {
      create: jest.fn().mockResolvedValue(item),
      findById: jest.fn().mockResolvedValue(item),
      update: jest.fn().mockResolvedValue({ ...item, isActive: false }),
      findBySku: jest.fn().mockResolvedValue(null),
      findByBarcode: jest.fn().mockResolvedValue(null),
      findScoped: jest.fn().mockResolvedValue([item]),
    };
    const service = new ItemsService(itemRepository as ItemRepository);
    return { service, itemRepository };
  }

  const createDto = {
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    unitId: 'u1',
    minStock: '10',
    maxStock: '100',
    costPrice: '85.50',
  };

  it('AC: cannot set minStock >= maxStock on create', async () => {
    const { service } = buildService();
    await expect(
      service.create(fixtureRequest(), { ...createDto, minStock: '100', maxStock: '100' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('AC: cannot create two items with the same SKU', async () => {
    const { service, itemRepository } = buildService();
    (itemRepository.findBySku as jest.Mock).mockResolvedValue(fixtureItem());
    await expect(service.create(fixtureRequest(), createDto)).rejects.toThrow(ConflictException);
  });

  it('rejects a duplicate barcode the same way', async () => {
    const { service, itemRepository } = buildService();
    (itemRepository.findByBarcode as jest.Mock).mockResolvedValue(fixtureItem());
    await expect(
      service.create(fixtureRequest(), { ...createDto, barcode: '8901030123456' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects create for a role not permitted to mutate items (e.g. STORE_STAFF)', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest('STORE_STAFF'), createDto)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects create for a caller with no access to the target outlet at all', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest(null), createDto)).rejects.toThrow(ForbiddenException);
  });

  it('creates successfully for an authorized role with valid data', async () => {
    const { service, itemRepository } = buildService();
    const request = fixtureRequest('OUTLET_MANAGER');
    await service.create(request, createDto);
    expect(itemRepository.create).toHaveBeenCalledWith({ ...createDto, performedById: request.user!.id });
  });

  it('findById throws NotFoundException for a missing item', async () => {
    const { service, itemRepository } = buildService();
    (itemRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.findById(fixtureRequest(), 'missing')).rejects.toThrow(NotFoundException);
  });

  it('findById is readable by any role with access to the outlet (no MUTATE_ROLES gate)', async () => {
    const { service } = buildService();
    await expect(service.findById(fixtureRequest('CHEF'), 'i1')).resolves.toBeDefined();
  });

  it('findById rejects a caller with no access to the item\'s outlet', async () => {
    const { service } = buildService();
    await expect(service.findById(fixtureRequest(null), 'i1')).rejects.toThrow(ForbiddenException);
  });

  it('update validates the effective stock range using existing values for fields not being changed', async () => {
    const { service } = buildService(fixtureItem({ minStock: '10', maxStock: '100' }));
    // Only lowering maxStock — service must compare against the EXISTING
    // minStock (10), not treat the omitted field as unbounded.
    await expect(service.update(fixtureRequest(), 'i1', { maxStock: '5' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update allows changing the SKU when the new one is unused', async () => {
    const { service, itemRepository } = buildService();
    await service.update(fixtureRequest(), 'i1', { sku: 'RICE-BAS-002' });
    expect(itemRepository.update).toHaveBeenCalledWith('i1', { sku: 'RICE-BAS-002' });
  });

  it('softDelete sets isActive false and does not touch currentStock', async () => {
    const { service, itemRepository } = buildService();
    await service.softDelete(fixtureRequest(), 'i1');
    expect(itemRepository.update).toHaveBeenCalledWith('i1', { isActive: false });
  });

  it('list scopes by the caller\'s effectiveOutletIds and converts string query params to booleans', async () => {
    const { service, itemRepository } = buildService();
    await service.list(fixtureRequest(), { belowMinStock: 'true', isActive: 'false' });
    expect(itemRepository.findScoped).toHaveBeenCalledWith(
      expect.objectContaining({ accessibleOutletIds: ['o1'], belowMinStock: true, isActive: false }),
    );
  });

  describe('clone', () => {
    it('AC: copies master data but never copies sku or current stock', async () => {
      const source = fixtureItem({
        currentStock: '37.500',
        defaultSupplierId: 's1',
        purchaseGLAccount: 'COGS',
        defaultTaxRateId: 't1',
      });
      const { service, itemRepository } = buildService(source);
      const request = fixtureRequest('OUTLET_MANAGER');

      await service.clone(request, 'i1', 'RICE-BAS-002');

      expect(itemRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          outletId: source.outletId,
          name: 'Basmati Rice (Copy)',
          categoryId: source.categoryId,
          sku: 'RICE-BAS-002',
          unitId: source.unitId,
          minStock: source.minStock,
          maxStock: source.maxStock,
          costPrice: source.costPrice,
          defaultSupplierId: source.defaultSupplierId,
          purchaseGLAccount: source.purchaseGLAccount,
          defaultTaxRateId: source.defaultTaxRateId,
          performedById: request.user!.id,
        }),
      );
      // No currentStock/openingStock field is ever passed through — the
      // clone always starts at 0 via CreateItemInput's own defaulting.
      const call = (itemRepository.create as jest.Mock).mock.calls[0][0];
      expect(call.currentStock).toBeUndefined();
      expect(call.openingStock).toBeUndefined();
    });

    it('rejects cloning into an already-used sku', async () => {
      const { service, itemRepository } = buildService();
      (itemRepository.findBySku as jest.Mock).mockResolvedValue(fixtureItem());
      await expect(service.clone(fixtureRequest(), 'i1', 'RICE-BAS-001')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects cloning for a role not permitted to mutate items', async () => {
      const { service } = buildService();
      await expect(service.clone(fixtureRequest('STORE_STAFF'), 'i1', 'RICE-BAS-002')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
