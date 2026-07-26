import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StockTransactionsService } from './stock-transactions.service';
import { StockTransactionRepository, CreateStockTransactionResult } from '../repositories/stock-transaction.repository';
import { StockTransaction } from '../domain/stock-transaction.entity';
import { ItemRepository } from '../../items/repositories/item.repository';
import { Item } from '../../items/domain/item.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

function fixtureItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    barcode: null,
    unit: 'KG',
    minStock: '10',
    maxStock: '100',
    currentStock: '42',
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

function fixtureTransaction(overrides: Partial<StockTransaction> = {}): StockTransaction {
  return {
    id: 't1',
    outletId: 'o1',
    itemId: 'i1',
    type: 'USAGE_OUT',
    quantity: '5.000',
    balanceAfter: '37.000',
    referenceType: null,
    referenceId: null,
    reasonCode: null,
    photoUrl: null,
    performedById: 'u1',
    createdAt: new Date(),
    ...overrides,
  };
}

// `null` (not `undefined`) means "no role at this outlet" — see the same
// note in items.service.spec.ts (a default parameter only substitutes for
// an omitted/`undefined` argument).
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

describe('StockTransactionsService', () => {
  function buildService(item = fixtureItem(), transactionResult?: CreateStockTransactionResult) {
    const itemRepository: Partial<ItemRepository> = {
      findById: jest.fn().mockResolvedValue(item),
    };
    const stockTransactionRepository: Partial<StockTransactionRepository> = {
      createWithBalanceUpdate: jest.fn().mockResolvedValue(
        transactionResult ?? {
          ok: true,
          transaction: fixtureTransaction(),
          item: { id: item.id, outletId: item.outletId, minStock: item.minStock, currentStock: '37.000' },
        },
      ),
      findById: jest.fn().mockResolvedValue(fixtureTransaction()),
      findScoped: jest.fn().mockResolvedValue([fixtureTransaction()]),
    };
    const auditLogService = { record: jest.fn() } as unknown as AuditLogService;
    const eventEmitter = { emit: jest.fn() } as any;
    const service = new StockTransactionsService(
      stockTransactionRepository as StockTransactionRepository,
      itemRepository as ItemRepository,
      auditLogService,
      eventEmitter,
    );
    return { service, itemRepository, stockTransactionRepository, auditLogService, eventEmitter };
  }

  const createDto = { itemId: 'i1', type: 'USAGE_OUT' as const, quantity: '5' };

  it('AC: quantity must be greater than 0', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest(), { ...createDto, quantity: '0' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('AC: WASTAGE_OUT without reasonCode returns a validation error', async () => {
    const { service } = buildService();
    await expect(
      service.create(fixtureRequest(), { itemId: 'i1', type: 'WASTAGE_OUT', quantity: '2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a reasonCode on a non-WASTAGE_OUT transaction', async () => {
    const { service } = buildService();
    await expect(
      service.create(fixtureRequest(), { ...createDto, reasonCode: 'EXPIRED' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CHEF may create USAGE_OUT/WASTAGE_OUT but not PURCHASE_IN', async () => {
    const { service } = buildService();
    await expect(
      service.create(fixtureRequest('CHEF'), { itemId: 'i1', type: 'PURCHASE_IN', quantity: '10' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.create(fixtureRequest('CHEF'), createDto)).resolves.toBeDefined();
  });

  it('STORE_STAFF may create any transaction type (no CHEF-only restriction)', async () => {
    const { service } = buildService();
    await expect(
      service.create(fixtureRequest('STORE_STAFF'), { itemId: 'i1', type: 'PURCHASE_IN', quantity: '10' }),
    ).resolves.toBeDefined();
  });

  it('rejects a caller with no access to the item\'s outlet', async () => {
    const { service } = buildService();
    await expect(service.create(fixtureRequest(null), createDto)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for a nonexistent item', async () => {
    const { service, itemRepository } = buildService();
    (itemRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.create(fixtureRequest(), createDto)).rejects.toThrow(NotFoundException);
  });

  it('rejects an insufficient-stock result (repository declined) as a 400, not a 500', async () => {
    const { service } = buildService(fixtureItem(), {
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
      item: { id: 'i1', outletId: 'o1', minStock: '10', currentStock: '2' },
    });
    await expect(service.create(fixtureRequest(), { ...createDto, quantity: '999' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('does NOT honor forceOverride from a STORE_STAFF (only OUTLET_MANAGER+)', async () => {
    const { service, stockTransactionRepository } = buildService();
    await service.create(fixtureRequest('STORE_STAFF'), { ...createDto, forceOverride: true });
    expect(stockTransactionRepository.createWithBalanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ allowNegativeBalance: false }),
    );
  });

  it('honors forceOverride from an OUTLET_MANAGER', async () => {
    const { service, stockTransactionRepository } = buildService();
    await service.create(fixtureRequest('OUTLET_MANAGER'), { ...createDto, forceOverride: true });
    expect(stockTransactionRepository.createWithBalanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ allowNegativeBalance: true }),
    );
  });

  it('AC: a force-overridden negative-balance transaction logs AuditLog severity HIGH', async () => {
    const { service, auditLogService } = buildService(fixtureItem(), {
      ok: true,
      transaction: fixtureTransaction({ balanceAfter: '-3.000' }),
      item: { id: 'i1', outletId: 'o1', minStock: '10', currentStock: '-3.000' },
    });
    await service.create(fixtureRequest('OUTLET_MANAGER'), { ...createDto, forceOverride: true });
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ severity: 'HIGH' }));
  });

  it('a normal (non-negative) transaction does not set severity', async () => {
    const { service, auditLogService } = buildService();
    await service.create(fixtureRequest('OUTLET_MANAGER'), createDto);
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ severity: undefined }));
  });

  it('emits item.stock.changed with the post-transaction balance', async () => {
    const { service, eventEmitter } = buildService();
    await service.create(fixtureRequest(), createDto);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'item.stock.changed',
      expect.objectContaining({ itemId: 'i1', currentStock: '37.000' }),
    );
  });

  it('findById rejects a caller with no access to the transaction\'s outlet', async () => {
    const { service } = buildService();
    await expect(service.findById(fixtureRequest(null), 't1')).rejects.toThrow(ForbiddenException);
  });

  it('findById throws NotFoundException for a missing transaction', async () => {
    const { service, stockTransactionRepository } = buildService();
    (stockTransactionRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.findById(fixtureRequest(), 'missing')).rejects.toThrow(NotFoundException);
  });

  it('list scopes by the caller\'s effectiveOutletIds', async () => {
    const { service, stockTransactionRepository } = buildService();
    await service.list(fixtureRequest(), {});
    expect(stockTransactionRepository.findScoped).toHaveBeenCalledWith(
      expect.objectContaining({ accessibleOutletIds: ['o1'] }),
    );
  });
});
