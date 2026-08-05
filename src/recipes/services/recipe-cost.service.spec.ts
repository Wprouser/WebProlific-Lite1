import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecipeCostService } from './recipe-cost.service';
import { Recipe, RecipeLine } from '../domain/recipe.entity';
import { RecipeRepository } from '../repositories/recipe.repository';
import { ItemRepository } from '../../items/repositories/item.repository';
import { Item } from '../../items/domain/item.entity';
import { UnitOfMeasureRepository } from '../../items/repositories/unit-of-measure.repository';
import { UnitOfMeasure } from '../../items/domain/unit-of-measure.entity';

function line(partial: Partial<RecipeLine> & { quantity: string }): RecipeLine {
  return { id: 'l', recipeId: 'r', itemId: null, subRecipeId: null, quantityUnitId: null, ...partial };
}

interface SeedOpts {
  isCurrent?: boolean;
  yieldQuantity?: string;
  yieldUnitId?: string;
}

class FakeRecipes implements Partial<RecipeRepository> {
  rows = new Map<string, Recipe>();

  seed(id: string, menuItemId: string, version: number, lines: RecipeLine[], opts: SeedOpts = {}) {
    this.rows.set(id, {
      id,
      menuItemId,
      version,
      isCurrent: opts.isCurrent ?? true,
      createdAt: new Date(),
      yieldQuantity: opts.yieldQuantity ?? null,
      yieldUnitId: opts.yieldUnitId ?? null,
      lines,
    });
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findCurrentByMenuItemId(menuItemId: string) {
    return [...this.rows.values()].find((r) => r.menuItemId === menuItemId && r.isCurrent) ?? null;
  }
  async findByMenuItemIdAndVersion(menuItemId: string, version: number) {
    return (
      [...this.rows.values()].find((r) => r.menuItemId === menuItemId && r.version === version) ??
      null
    );
  }
  async findLinesForRecipeIds(recipeIds: string[]) {
    const map = new Map<string, RecipeLine[]>();
    for (const id of recipeIds) {
      const row = this.rows.get(id);
      if (row) map.set(id, row.lines);
    }
    return map;
  }
}

class FakeItems implements Partial<ItemRepository> {
  rows = new Map<string, Item>();
  seed(id: string, costPrice: string, name = id) {
    this.rows.set(id, { id, name, costPrice, unitId: 'kg', outletId: 'o1' } as Item);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
}

/** kg/g share a base (g); litre is a different family, so kg -> l must throw. */
class FakeUnits implements Partial<UnitOfMeasureRepository> {
  rows = new Map<string, UnitOfMeasure>([
    ['g', { id: 'g', abbreviation: 'g', baseUnitId: null, conversionFactor: null } as UnitOfMeasure],
    [
      'kg',
      { id: 'kg', abbreviation: 'kg', baseUnitId: 'g', conversionFactor: '1000' } as UnitOfMeasure,
    ],
    ['l', { id: 'l', abbreviation: 'l', baseUnitId: null, conversionFactor: null } as UnitOfMeasure],
  ]);
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
}

function build() {
  const recipes = new FakeRecipes();
  const items = new FakeItems();
  const units = new FakeUnits();
  const service = new RecipeCostService(
    recipes as unknown as RecipeRepository,
    items as unknown as ItemRepository,
    units as unknown as UnitOfMeasureRepository,
  );
  return { service, recipes, items, units };
}

describe('RecipeCostService', () => {
  it('costs a flat recipe from current ingredient prices', async () => {
    const { service, recipes, items } = build();
    items.seed('rice', '4.50');
    items.seed('chicken', '22.00');
    recipes.seed('r1', 'mi1', 1, [
      line({ itemId: 'rice', quantity: '0.2000' }),
      line({ itemId: 'chicken', quantity: '0.1500' }),
    ]);

    const cost = await service.costRecipeVersion('mi1');

    // 0.2 * 4.50 = 0.90 ; 0.15 * 22.00 = 3.30
    expect(cost.components.map((c) => c.lineCost)).toEqual(['0.90', '3.30']);
    expect(cost.totalCost).toBe('4.20');
    expect(cost.recipeVersion).toBe(1);
    expect(cost.usesLegacyBatchMultiplier).toBe(false);
  });

  it('AC: costs a past version against that version’s ingredient list', async () => {
    const { service, recipes, items } = build();
    items.seed('cheap', '1.00');
    items.seed('pricey', '50.00');
    recipes.seed('v1', 'mi1', 1, [line({ itemId: 'cheap', quantity: '1.0000' })], {
      isCurrent: false,
    });
    recipes.seed('v2', 'mi1', 2, [line({ itemId: 'pricey', quantity: '1.0000' })]);

    // A Sale that recorded recipeVersionUsed=1 must not be costed against v2.
    await expect(service.costRecipeVersion('mi1', 1)).resolves.toMatchObject({
      recipeVersion: 1,
      totalCost: '1.00',
    });
    await expect(service.costRecipeVersion('mi1')).resolves.toMatchObject({
      recipeVersion: 2,
      totalCost: '50.00',
    });
  });

  it('rounds the total once rather than summing rounded lines', async () => {
    const { service, recipes, items } = build();
    for (const id of ['a', 'b', 'c']) items.seed(id, '0.04');
    recipes.seed('r1', 'mi1', 1, [
      line({ itemId: 'a', quantity: '0.1000' }),
      line({ itemId: 'b', quantity: '0.1000' }),
      line({ itemId: 'c', quantity: '0.1000' }),
    ]);

    const cost = await service.costRecipeVersion('mi1');
    expect(cost.components.map((c) => c.lineCost)).toEqual(['0.00', '0.00', '0.00']);
    expect(cost.totalCost).toBe('0.01');
  });

  it('keeps sub-gram ingredients from vanishing into rounding', async () => {
    const { service, recipes, items } = build();
    // 0.0025 kg of saffron at 8000/kg = 20.00 — the case that motivated
    // Decimal(10,4) over Decimal(10,3).
    items.seed('saffron', '8000.00');
    recipes.seed('r1', 'mi1', 1, [line({ itemId: 'saffron', quantity: '0.0025' })]);

    await expect(service.costRecipeVersion('mi1')).resolves.toMatchObject({ totalCost: '20.00' });
  });

  it('404s a menu item with no recipe', async () => {
    const { service } = build();
    await expect(service.costRecipeVersion('nope')).rejects.toThrow(NotFoundException);
  });

  it('404s an unknown version', async () => {
    const { service, recipes } = build();
    recipes.seed('r1', 'mi1', 1, []);
    await expect(service.costRecipeVersion('mi1', 7)).rejects.toThrow(/version 7 not found/);
  });

  it('reports a deleted ingredient as a 400 rather than costing it as zero', async () => {
    const { service, recipes } = build();
    recipes.seed('r1', 'mi1', 1, [line({ itemId: 'ghost', quantity: '1.0000' })]);
    await expect(service.costRecipeVersion('mi1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to cost a stored circular graph instead of hanging', async () => {
    const { service, recipes } = build();
    recipes.seed('a', 'mi-a', 1, [line({ subRecipeId: 'b', quantity: '1.0000' })]);
    recipes.seed('b', 'mi-b', 1, [line({ subRecipeId: 'a', quantity: '1.0000' })]);

    await expect(service.costRecipeVersion('mi-a')).rejects.toThrow(/circular/i);
  });

  it('costs an empty recipe as zero rather than failing', async () => {
    const { service, recipes } = build();
    recipes.seed('r1', 'mi1', 1, []);
    await expect(service.costRecipeVersion('mi1')).resolves.toMatchObject({
      totalCost: '0.00',
      components: [],
    });
  });
});

describe('RecipeCostService — yield-based sub-recipes', () => {
  it('AC: divides the line quantity by the sub-recipe’s batch yield', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '3.00');
    // Sauce: a 2 kg batch made from 1.5 kg tomato. Dish uses 0.5 kg of it.
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '1.5000' })], {
      yieldQuantity: '2',
      yieldUnitId: 'kg',
    });
    recipes.seed('dish', 'mi-dish', 1, [
      line({ subRecipeId: 'sauce', quantity: '0.5000', quantityUnitId: 'kg' }),
    ]);

    const cost = await service.costRecipeVersion('mi-dish');
    // 0.5/2 = 0.25 batch -> 0.375 kg tomato -> 1.125
    expect(cost.components[0].quantity).toBe('0.375');
    expect(cost.totalCost).toBe('1.13');
    expect(cost.usesLegacyBatchMultiplier).toBe(false);
  });

  it('AC: converts a line unit that differs from the yield unit (FR-01)', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '3.00');
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '1.5000' })], {
      yieldQuantity: '2',
      yieldUnitId: 'kg',
    });
    // Same 0.5 kg, expressed as 500 g.
    recipes.seed('dish', 'mi-dish', 1, [
      line({ subRecipeId: 'sauce', quantity: '500.0000', quantityUnitId: 'g' }),
    ]);

    const cost = await service.costRecipeVersion('mi-dish');
    expect(cost.components[0].quantity).toBe('0.375');
  });

  it('AC: rejects a line unit from an unrelated family at cost time', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '3.00');
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '1.5000' })], {
      yieldQuantity: '2',
      yieldUnitId: 'kg',
    });
    recipes.seed('dish', 'mi-dish', 1, [
      line({ subRecipeId: 'sauce', quantity: '1.0000', quantityUnitId: 'l' }),
    ]);

    await expect(service.costRecipeVersion('mi-dish')).rejects.toThrow(/common base unit/);
  });

  it('AC: the 200g-of-a-3kg-batch case no longer drifts', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '1.00');
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '2.0000' })], {
      yieldQuantity: '3',
      yieldUnitId: 'kg',
    });
    recipes.seed('dish', 'mi-dish', 1, [
      line({ subRecipeId: 'sauce', quantity: '0.2000', quantityUnitId: 'kg' }),
    ]);

    const cost = await service.costRecipeVersion('mi-dish');
    const drift = Math.abs(Number(cost.components[0].quantity) - 2 * (0.2 / 3));
    expect(drift).toBeLessThan(1e-7);
  });
});

describe('RecipeCostService — legacy (yield-less) sub-recipes', () => {
  it('AC: a yield-less sub-recipe keeps resolving by batch multiplier', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '3.00');
    // No yield — exactly how rows written before the amendment look.
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '0.5000' })]);
    recipes.seed('dish', 'mi-dish', 1, [line({ subRecipeId: 'sauce', quantity: '2.0000' })]);

    const cost = await service.costRecipeVersion('mi-dish');
    // 2 batches x 0.5 kg = 1 kg, unchanged from before the amendment.
    expect(cost.components[0].quantity).toBe('1');
    expect(cost.totalCost).toBe('3.00');
  });

  it('AC: the legacy path is flagged so it can be tracked', async () => {
    const { service, recipes, items } = build();
    items.seed('tomato', '3.00');
    recipes.seed('sauce', 'mi-sauce', 1, [line({ itemId: 'tomato', quantity: '0.5000' })]);
    recipes.seed('dish', 'mi-dish', 1, [line({ subRecipeId: 'sauce', quantity: '2.0000' })]);

    await expect(service.costRecipeVersion('mi-dish')).resolves.toMatchObject({
      usesLegacyBatchMultiplier: true,
    });
  });

  it('flags legacy when only a deeper node lacks a yield', async () => {
    const { service, recipes, items } = build();
    items.seed('flour', '1.00');
    recipes.seed('base', 'mi-base', 1, [line({ itemId: 'flour', quantity: '1.0000' })]);
    recipes.seed('sauce', 'mi-sauce', 1, [line({ subRecipeId: 'base', quantity: '1.0000' })], {
      yieldQuantity: '2',
      yieldUnitId: 'kg',
    });
    recipes.seed('dish', 'mi-dish', 1, [
      line({ subRecipeId: 'sauce', quantity: '1.0000', quantityUnitId: 'kg' }),
    ]);

    await expect(service.costRecipeVersion('mi-dish')).resolves.toMatchObject({
      usesLegacyBatchMultiplier: true,
    });
  });
});
