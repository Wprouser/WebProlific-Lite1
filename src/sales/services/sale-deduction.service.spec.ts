import { NotFoundException } from '@nestjs/common';
import { SaleDeductionService } from './sale-deduction.service';
import { SaleRepository } from '../repositories/sale.repository';
import { MenuItemRepository } from '../../recipes/repositories/menu-item.repository';
import { RecipeRepository } from '../../recipes/repositories/recipe.repository';
import { ItemRepository } from '../../items/repositories/item.repository';
import { RecipeCostService, ResolvedRecipeVersion } from '../../recipes/services/recipe-cost.service';
import { StockTransactionsService } from '../../stock-transactions/services/stock-transactions.service';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';
import { Sale } from '../domain/sale.entity';

const OUTLET = 'o1';
const MENU_ITEM = 'm1';

function fixtureSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-1',
    outletId: OUTLET,
    menuItemId: MENU_ITEM,
    quantitySold: '2.000',
    recipeVersionUsed: 1,
    posReferenceId: 'pos-1',
    sourceType: 'WEBHOOK',
    importBatchId: null,
    isVoid: false,
    voidedAt: null,
    saleTimestamp: new Date('2026-07-20T12:34:00Z'),
    createdAt: new Date('2026-07-20T12:34:01Z'),
    ...overrides,
  };
}

function fixtureResolved(overrides: Partial<ResolvedRecipeVersion> = {}): ResolvedRecipeVersion {
  return {
    menuItemId: MENU_ITEM,
    recipeId: 'r1',
    recipeVersion: 1,
    ingredients: [{ itemId: 'rice', quantity: '0.25' }],
    usesLegacyBatchMultiplier: false,
    legacyRecipeIds: [],
    ...overrides,
  };
}

describe('SaleDeductionService', () => {
  function build(options: {
    resolved?: ResolvedRecipeVersion | null;
    createdSale?: { sale: Sale; created: boolean };
    wentNegative?: boolean;
  } = {}) {
    const saleRepository: Partial<SaleRepository> = {
      createIfAbsent: jest
        .fn()
        .mockResolvedValue(options.createdSale ?? { sale: fixtureSale(), created: true }),
      markVoided: jest.fn().mockImplementation(async (id: string) => fixtureSale({ id, isVoid: true })),
    };
    const menuItemRepository: Partial<MenuItemRepository> = {
      findById: jest.fn().mockResolvedValue({ id: MENU_ITEM, outletId: OUTLET, name: 'Biryani', isActive: true }),
    };
    const recipeRepository: Partial<RecipeRepository> = {
      findCurrentByMenuItemId: jest
        .fn()
        .mockResolvedValue(options.resolved === null ? null : { id: 'r1', version: 1 }),
      findById: jest.fn().mockResolvedValue({ id: 'legacy-r', menuItemId: 'sauce-mi', version: 1 }),
    };
    const itemRepository: Partial<ItemRepository> = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'rice', name: 'Rice', unitId: 'kg', currentStock: '10.000' }),
    };
    const recipeCostService: Partial<RecipeCostService> = {
      resolveRecipeVersion: jest.fn().mockResolvedValue(options.resolved ?? fixtureResolved()),
    };
    const stockTransactionsService = {
      createSystem: jest.fn().mockResolvedValue({
        transaction: { id: 't1', balanceAfter: '9.500' },
        wentNegative: options.wentNegative ?? false,
      }),
      findByReference: jest.fn().mockResolvedValue([]),
    } as unknown as StockTransactionsService;
    const activityBus = { record: jest.fn() } as unknown as ActivityBus;

    const service = new SaleDeductionService(
      saleRepository as SaleRepository,
      menuItemRepository as MenuItemRepository,
      recipeRepository as RecipeRepository,
      itemRepository as ItemRepository,
      recipeCostService as RecipeCostService,
      stockTransactionsService,
      activityBus,
    );
    return { service, saleRepository, menuItemRepository, recipeRepository, stockTransactionsService, activityBus };
  }

  const input = {
    outletId: OUTLET,
    menuItemId: MENU_ITEM,
    quantitySold: '2',
    posReferenceId: 'pos-1',
    sourceType: 'WEBHOOK' as const,
    saleTimestamp: new Date('2026-07-20T12:34:00Z'),
  };

  it('multiplies the per-portion recipe quantity by portions sold', async () => {
    const { service, stockTransactionsService } = build();
    await service.recordSale(input);
    expect(stockTransactionsService.createSystem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'rice', quantity: '0.5', type: 'USAGE_OUT' }),
    );
  });

  it('references the sale, so a void can replay exactly these movements', async () => {
    const { service, stockTransactionsService } = build();
    await service.recordSale(input);
    expect(stockTransactionsService.createSystem).toHaveBeenCalledWith(
      expect.objectContaining({ referenceType: 'SALE', referenceId: 'sale-1' }),
    );
  });

  it('AC: a replayed posReferenceId deducts nothing a second time', async () => {
    const { service, stockTransactionsService } = build({
      createdSale: { sale: fixtureSale(), created: false },
    });
    const result = await service.recordSale(input);
    expect(result.alreadyProcessed).toBe(true);
    expect(result.deducted).toBe(false);
    expect(stockTransactionsService.createSystem).not.toHaveBeenCalled();
  });

  it('AC: a menu item with no recipe records the sale, deducts nothing, and warns', async () => {
    const { service, saleRepository, stockTransactionsService, activityBus } = build({ resolved: null });
    const result = await service.recordSale(input);

    expect(result.deducted).toBe(false);
    expect(stockTransactionsService.createSystem).not.toHaveBeenCalled();
    // recipeVersionUsed null is what puts it on the Unmapped Items worklist.
    expect(saleRepository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ recipeVersionUsed: null }),
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({ action: 'RECIPE_MISSING', message: expect.stringContaining('Biryani') }),
    ]);
    expect(activityBus.record).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ALERT', action: 'RECIPE_MISSING', entityId: MENU_ITEM }),
    );
  });

  it('deducts through a legacy yield-less sub-recipe and names it in the warning', async () => {
    const { service, stockTransactionsService } = build({
      resolved: fixtureResolved({ usesLegacyBatchMultiplier: true, legacyRecipeIds: ['legacy-r'] }),
    });
    const result = await service.recordSale(input);

    // The deduction still happens — imprecise beats absent.
    expect(stockTransactionsService.createSystem).toHaveBeenCalled();
    expect(result.deducted).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ action: 'LEGACY_RECIPE_DEDUCTION', recipeId: 'legacy-r' }),
    ]);
    expect(result.warnings[0].message).toContain('no yield set');
  });

  it('logs the legacy warning against the sub-recipe\'s own menu item, not the dish sold', async () => {
    const { service, activityBus } = build({
      resolved: fixtureResolved({ usesLegacyBatchMultiplier: true, legacyRecipeIds: ['legacy-r'] }),
    });
    await service.recordSale(input);
    // 'sauce-mi' owns the yield-less recipe; that is the row a user opens to
    // fix it, and where the "Needs yield" badge appears.
    expect(activityBus.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LEGACY_RECIPE_DEDUCTION', entityId: 'sauce-mi' }),
    );
  });

  it('records an oversell rather than refusing the sale, and warns', async () => {
    const { service, activityBus } = build({ wentNegative: true });
    const result = await service.recordSale(input);

    expect(result.deducted).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ action: 'NEGATIVE_STOCK_ON_SALE', itemId: 'rice' }),
    ]);
    expect(activityBus.record).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ALERT', action: 'NEGATIVE_STOCK_ON_SALE' }),
    );
  });

  it('one failing ingredient does not stop the others being deducted', async () => {
    const { service, stockTransactionsService } = build({
      resolved: fixtureResolved({
        ingredients: [
          { itemId: 'deleted-item', quantity: '1' },
          { itemId: 'rice', quantity: '0.25' },
        ],
      }),
    });
    (stockTransactionsService.createSystem as jest.Mock).mockImplementationOnce(() => {
      throw new NotFoundException('Item deleted-item not found');
    });

    const result = await service.recordSale(input);
    expect(stockTransactionsService.createSystem).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.deducted).toBe(true);
  });

  it('skips a quantity that rounds below the ledger\'s 3dp resolution', async () => {
    const { service, stockTransactionsService } = build({
      // 0.0000004 kg x 2 portions — a pinch of saffron, below Decimal(10,3).
      resolved: fixtureResolved({ ingredients: [{ itemId: 'saffron', quantity: '0.0000004' }] }),
    });
    await service.recordSale(input);
    expect(stockTransactionsService.createSystem).not.toHaveBeenCalled();
  });

  it('rejects a sale for a menu item that does not exist', async () => {
    const { service, menuItemRepository } = build();
    (menuItemRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.recordSale(input)).rejects.toThrow(NotFoundException);
  });

  // ------------------------------------------------------------------ void

  it('AC: voiding reverses the movements actually written, not a fresh resolution', async () => {
    const { service, stockTransactionsService, recipeRepository } = build();
    (stockTransactionsService.findByReference as jest.Mock).mockResolvedValue([
      { id: 't1', itemId: 'rice', type: 'USAGE_OUT', quantity: '0.500' },
      { id: 't2', itemId: 'saffron', type: 'USAGE_OUT', quantity: '0.002' },
    ]);

    const result = await service.voidSale(fixtureSale());

    expect(result.reversedCount).toBe(2);
    expect(stockTransactionsService.createSystem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'rice', type: 'ADJUSTMENT_IN', quantity: '0.500' }),
    );
    expect(stockTransactionsService.createSystem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'saffron', type: 'ADJUSTMENT_IN', quantity: '0.002' }),
    );
    // The recipe is never consulted — that's the whole point.
    expect(recipeRepository.findCurrentByMenuItemId).not.toHaveBeenCalled();
  });

  it('a void skips reversal rows, so replaying one cannot inflate stock', async () => {
    const { service, stockTransactionsService } = build();
    (stockTransactionsService.findByReference as jest.Mock).mockResolvedValue([
      { id: 't1', itemId: 'rice', type: 'USAGE_OUT', quantity: '0.500' },
      { id: 't2', itemId: 'rice', type: 'ADJUSTMENT_IN', quantity: '0.500' },
    ]);
    const result = await service.voidSale(fixtureSale());
    expect(result.reversedCount).toBe(1);
    expect(stockTransactionsService.createSystem).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------- impact preview

  it('projects impact across rows without deducting anything', async () => {
    const { service, stockTransactionsService } = build();
    const { impact } = await service.projectImpact([
      { menuItemId: MENU_ITEM, quantitySold: '2' },
      { menuItemId: MENU_ITEM, quantitySold: '3' },
    ]);

    expect(stockTransactionsService.createSystem).not.toHaveBeenCalled();
    // 0.25 x (2 + 3) = 1.25, against 10 in stock.
    expect(impact).toEqual([
      expect.objectContaining({ itemId: 'rice', quantity: '1.25', currentStock: '10.000', projectedStock: '8.75' }),
    ]);
  });

  it('reports a projected shortfall as a negative projected stock', async () => {
    const { service } = build();
    const { impact } = await service.projectImpact([{ menuItemId: MENU_ITEM, quantitySold: '100' }]);
    // 0.25 x 100 = 25 against 10 in stock.
    expect(impact[0]).toMatchObject({ quantity: '25', projectedStock: '-15' });
  });

  it('lists menu items with no recipe rather than silently contributing nothing', async () => {
    const { service } = build({ resolved: null });
    const result = await service.projectImpact([{ menuItemId: MENU_ITEM, quantitySold: '2' }]);
    expect(result.impact).toEqual([]);
    expect(result.unresolvableMenuItemIds).toEqual([MENU_ITEM]);
  });
});
