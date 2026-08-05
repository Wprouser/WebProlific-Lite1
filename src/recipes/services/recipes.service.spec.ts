import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RecipesService } from './recipes.service';
import { MenuItem } from '../domain/menu-item.entity';
import { Recipe, RecipeLine } from '../domain/recipe.entity';
import { MenuItemRepository } from '../repositories/menu-item.repository';
import { CreateRecipeInput, RecipeRepository } from '../repositories/recipe.repository';
import { ItemRepository } from '../../items/repositories/item.repository';
import { Item } from '../../items/domain/item.entity';
import { UnitOfMeasureRepository } from '../../items/repositories/unit-of-measure.repository';
import { UnitOfMeasure } from '../../items/domain/unit-of-measure.entity';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { Role } from '../../tenancy/constants/enums';

const OUTLET = 'outlet-1';
const OTHER_OUTLET = 'outlet-2';

function requestFor(role: Role = 'OUTLET_MANAGER', outletIds = [OUTLET]): RequestWithAccess {
  return {
    user: { id: 'user-1' },
    effectiveOutletIds: outletIds,
    effectiveAccess: {
      roleForOutlet: (outletId: string) => (outletIds.includes(outletId) ? role : undefined),
    },
  } as unknown as RequestWithAccess;
}

/** In-memory doubles — the logic under test is orchestration, not SQL. */
class FakeMenuItems implements MenuItemRepository {
  rows = new Map<string, MenuItem>();
  private seq = 0;

  seed(menuItem: Partial<MenuItem> & { id: string }): MenuItem {
    const row: MenuItem = {
      outletId: OUTLET,
      name: `Menu ${menuItem.id}`,
      isActive: false,
      ...menuItem,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async create(data: { outletId: string; name: string }): Promise<MenuItem> {
    return this.seed({ id: `mi-${++this.seq}`, ...data });
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByOutletAndName(outletId: string, name: string) {
    return [...this.rows.values()].find((r) => r.outletId === outletId && r.name === name) ?? null;
  }
  async update(id: string, data: Partial<MenuItem>) {
    const row = { ...this.rows.get(id)!, ...data };
    this.rows.set(id, row);
    return row;
  }
  async findScoped() {
    return [...this.rows.values()];
  }
}

class FakeRecipes implements RecipeRepository {
  rows = new Map<string, Recipe>();
  created: CreateRecipeInput[] = [];
  private seq = 0;

  seed(recipe: Partial<Recipe> & { id: string; menuItemId: string }): Recipe {
    const row: Recipe = {
      version: 1,
      isCurrent: true,
      createdAt: new Date('2026-01-01'),
      yieldQuantity: null,
      yieldUnitId: null,
      lines: [],
      ...recipe,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async createVersion(data: CreateRecipeInput): Promise<Recipe> {
    this.created.push(data);
    for (const row of this.rows.values()) {
      if (row.menuItemId === data.menuItemId) row.isCurrent = false;
    }
    return this.seed({
      id: `r-${++this.seq}`,
      menuItemId: data.menuItemId,
      version: data.version,
      isCurrent: true,
      yieldQuantity: data.yieldQuantity ?? null,
      yieldUnitId: data.yieldUnitId ?? null,
      lines: data.lines.map((line, i) => ({
        id: `rl-${i}`,
        recipeId: `r-${this.seq}`,
        itemId: line.itemId ?? null,
        subRecipeId: line.subRecipeId ?? null,
        quantity: line.quantity,
        quantityUnitId: line.quantityUnitId ?? null,
      })),
    });
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findCurrentByMenuItemId(menuItemId: string) {
    return [...this.rows.values()].find((r) => r.menuItemId === menuItemId && r.isCurrent) ?? null;
  }
  async findAllByMenuItemId(menuItemId: string) {
    return [...this.rows.values()]
      .filter((r) => r.menuItemId === menuItemId)
      .sort((a, b) => b.version - a.version);
  }
  async findByMenuItemIdAndVersion(menuItemId: string, version: number) {
    return (
      [...this.rows.values()].find((r) => r.menuItemId === menuItemId && r.version === version) ??
      null
    );
  }
  async maxVersionForMenuItem(menuItemId: string) {
    return [...this.rows.values()]
      .filter((r) => r.menuItemId === menuItemId)
      .reduce((max, r) => Math.max(max, r.version), 0);
  }
  async findLinesForRecipeIds(recipeIds: string[]) {
    const map = new Map<string, RecipeLine[]>();
    for (const id of recipeIds) {
      const row = this.rows.get(id);
      if (row) map.set(id, row.lines);
    }
    return map;
  }
  async findMenuItemIdsForRecipeIds(recipeIds: string[]) {
    const map = new Map<string, string>();
    for (const id of recipeIds) {
      const row = this.rows.get(id);
      if (row) map.set(id, row.menuItemId);
    }
    return map;
  }
}

class FakeItems implements Partial<ItemRepository> {
  rows = new Map<string, Item>();
  seed(id: string, outletId = OUTLET, costPrice = '10.00'): Item {
    const row = { id, outletId, name: `Item ${id}`, costPrice, unitId: 'unit-1' } as Item;
    this.rows.set(id, row);
    return row;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
}

/** kg and g share a base (g); litre is a different family, so kg -> l throws. */
class FakeUnits implements Partial<UnitOfMeasureRepository> {
  rows = new Map<string, UnitOfMeasure>([
    ['g', { id: 'g', outletId: OUTLET, abbreviation: 'g', baseUnitId: null, conversionFactor: null } as UnitOfMeasure],
    ['kg', { id: 'kg', outletId: OUTLET, abbreviation: 'kg', baseUnitId: 'g', conversionFactor: '1000' } as UnitOfMeasure],
    ['l', { id: 'l', outletId: OUTLET, abbreviation: 'l', baseUnitId: null, conversionFactor: null } as UnitOfMeasure],
    ['foreign-kg', { id: 'foreign-kg', outletId: OTHER_OUTLET, abbreviation: 'kg', baseUnitId: null, conversionFactor: null } as UnitOfMeasure],
  ]);
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
}

function build() {
  const menuItems = new FakeMenuItems();
  const recipes = new FakeRecipes();
  const items = new FakeItems();
  const units = new FakeUnits();
  const service = new RecipesService(
    menuItems,
    recipes,
    items as unknown as ItemRepository,
    units as unknown as UnitOfMeasureRepository,
  );
  return { service, menuItems, recipes, items, units };
}

describe('RecipesService — versioning', () => {
  it('AC: editing a recipe creates a new version and the old one remains queryable', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');
    items.seed('item-b');

    const v1 = await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-a', quantity: '0.2000' }],
    });
    const v2 = await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-b', quantity: '0.3000' }],
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.isCurrent).toBe(true);

    const history = await service.getRecipeHistory(requestFor(), 'mi-1');
    expect(history.map((r) => r.version)).toEqual([2, 1]);
    // The point of the whole design: version 1's lines are untouched.
    expect(history[1].lines[0].itemId).toBe('item-a');
    expect(history[1].isCurrent).toBe(false);
  });

  it('never mutates the previous version’s rows', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');
    items.seed('item-b');

    await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-a', quantity: '1.0000' }],
    });
    const before = JSON.stringify(recipes.rows.get('r-1')!.lines);

    await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-b', quantity: '2.0000' }],
    });

    expect(JSON.stringify(recipes.rows.get('r-1')!.lines)).toBe(before);
  });

  it('numbers the next version from the highest ever used, not the count', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');
    // Simulates history where version 2 was created and later superseded.
    recipes.seed({ id: 'old-1', menuItemId: 'mi-1', version: 1, isCurrent: false });
    recipes.seed({ id: 'old-2', menuItemId: 'mi-1', version: 2, isCurrent: true });

    const next = await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-a', quantity: '1.0000' }],
    });
    expect(next.version).toBe(3);
  });
});

describe('RecipesService — line validation', () => {
  it('rejects a line with both itemId and subRecipeId', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');
    recipes.seed({ id: 'sub-1', menuItemId: 'mi-1', yieldQuantity: '1', yieldUnitId: 'kg' });

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ itemId: 'item-a', subRecipeId: 'sub-1', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/exactly one of itemId or subRecipeId.*both/);
  });

  it('rejects a line with neither itemId nor subRecipeId', async () => {
    const { service, menuItems } = build();
    menuItems.seed({ id: 'mi-1' });

    await expect(
      service.createRecipe(requestFor(), 'mi-1', { lines: [{ quantity: '1.0000' }] }),
    ).rejects.toThrow(/exactly one of itemId or subRecipeId.*neither/);
  });

  it('rejects a zero quantity', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ itemId: 'item-a', quantity: '0.0000' }],
      }),
    ).rejects.toThrow(/greater than zero/);
  });

  it('rejects an ingredient belonging to a different outlet', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1', outletId: OUTLET });
    items.seed('foreign', OTHER_OUTLET);

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ itemId: 'foreign', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/different outlet/);
  });

  it('rejects a sub-recipe belonging to a different outlet', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-1', outletId: OUTLET });
    menuItems.seed({ id: 'mi-foreign', outletId: OTHER_OUTLET });
    recipes.seed({ id: 'sub-foreign', menuItemId: 'mi-foreign', yieldQuantity: '1', yieldUnitId: 'kg' });

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ subRecipeId: 'sub-foreign', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/different outlet/);
  });

  it('writes nothing when validation fails', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [
          { itemId: 'item-a', quantity: '1.0000' },
          { quantity: '1.0000' }, // invalid
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    // Versions are append-only and undeletable, so a partial write would be
    // permanent.
    expect(recipes.created).toHaveLength(0);
  });
});

describe('RecipesService — circular sub-recipes', () => {
  it('AC: rejects a recipe that would contain itself indirectly', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-a', name: 'Biryani' });
    menuItems.seed({ id: 'mi-b', name: 'Masala Base' });
    items.seed('rice');

    // Existing: Masala Base (r-b) contains Biryani's current recipe (r-a).
    const rA = recipes.seed({
      id: 'r-a',
      menuItemId: 'mi-a',
      lines: [],
      yieldQuantity: '1',
      yieldUnitId: 'kg',
    });
    recipes.seed({
      id: 'r-b',
      menuItemId: 'mi-b',
      yieldQuantity: '1',
      yieldUnitId: 'kg',
      lines: [{ id: 'l1', recipeId: 'r-b', itemId: null, subRecipeId: rA.id, quantity: '1.0000', quantityUnitId: 'kg' }],
    });

    // Now try to make Biryani contain Masala Base -> closes the loop.
    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '1.0000', quantityUnitId: 'kg' }],
      }),
    ).rejects.toThrow(/[Cc]ircular sub-recipe reference/);
  });

  it('AC: names the menu item rather than leaking a synthetic root id', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-a', name: 'Biryani' });
    menuItems.seed({ id: 'mi-b', name: 'Masala Base' });
    const rA = recipes.seed({
      id: 'r-a',
      menuItemId: 'mi-a',
      lines: [],
      yieldQuantity: '1',
      yieldUnitId: 'kg',
    });
    recipes.seed({
      id: 'r-b',
      menuItemId: 'mi-b',
      yieldQuantity: '1',
      yieldUnitId: 'kg',
      lines: [{ id: 'l1', recipeId: 'r-b', itemId: null, subRecipeId: rA.id, quantity: '1.0000', quantityUnitId: 'kg' }],
    });

    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '1.0000', quantityUnitId: 'kg' }],
      }),
    ).rejects.toThrow(/Biryani/);
  });

  it('accepts a legitimate nested sub-recipe', async () => {
    const { service, menuItems, recipes, items } = build();
    menuItems.seed({ id: 'mi-a' });
    menuItems.seed({ id: 'mi-b' });
    items.seed('tomato');
    recipes.seed({
      id: 'r-b',
      menuItemId: 'mi-b',
      yieldQuantity: '2',
      yieldUnitId: 'kg',
      lines: [{ id: 'l1', recipeId: 'r-b', itemId: 'tomato', subRecipeId: null, quantity: '0.3', quantityUnitId: null }],
    });

    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '2.0000', quantityUnitId: 'kg' }],
      }),
    ).resolves.toBeDefined();
  });

  it('reports a dangling sub-recipe reference as a 400, not a cycle', async () => {
    const { service, menuItems } = build();
    menuItems.seed({ id: 'mi-1' });

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ subRecipeId: '11111111-1111-4111-8111-111111111111', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('RecipesService — activation', () => {
  it('AC: cannot activate a menu item with no recipe', async () => {
    const { service, menuItems } = build();
    menuItems.seed({ id: 'mi-1' });

    await expect(service.activateMenuItem(requestFor(), 'mi-1')).rejects.toThrow(ConflictException);
  });

  it('AC: cannot activate a menu item whose recipe has zero lines', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-1' });
    recipes.seed({ id: 'r-1', menuItemId: 'mi-1', lines: [] });

    await expect(service.activateMenuItem(requestFor(), 'mi-1')).rejects.toThrow(
      /recipe has no lines/,
    );
  });

  it('activates once a recipe with lines exists', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');
    await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-a', quantity: '1.0000' }],
    });

    const activated = await service.activateMenuItem(requestFor(), 'mi-1');
    expect(activated.isActive).toBe(true);
  });

  it('new menu items start inactive', async () => {
    const { service } = build();
    const created = await service.createMenuItem(requestFor(), {
      outletId: OUTLET,
      name: 'Biryani',
    });
    expect(created.isActive).toBe(false);
  });
});

describe('RecipesService — access control', () => {
  it('refuses a menu item in an outlet the caller cannot reach', async () => {
    const { service, menuItems } = build();
    menuItems.seed({ id: 'mi-foreign', outletId: OTHER_OUTLET });

    await expect(service.getMenuItem(requestFor(), 'mi-foreign')).rejects.toThrow(
      /No access to outlet/,
    );
  });

  it('refuses recipe creation from a role without mutate rights', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor('STORE_STAFF'), 'mi-1', {
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/Requires role/);
  });

  it('allows CHEF to maintain recipes', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor('CHEF'), 'mi-1', {
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).resolves.toBeDefined();
  });

  it('404s an unknown menu item', async () => {
    const { service } = build();
    await expect(service.getMenuItem(requestFor(), 'nope')).rejects.toThrow(NotFoundException);
  });
});

describe('RecipesService — yield validation (FR-05 amendment)', () => {
  it('AC: a recipe with no yield cannot be referenced as a sub-recipe (409)', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-a' });
    menuItems.seed({ id: 'mi-b' });
    // Legacy shape: no yield.
    recipes.seed({ id: 'r-b', menuItemId: 'mi-b', lines: [] });

    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '1.0000', quantityUnitId: 'kg' }],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('AC: a sub-recipe line unit must share a base unit with the yield unit (400)', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-a' });
    menuItems.seed({ id: 'mi-b' });
    recipes.seed({ id: 'r-b', menuItemId: 'mi-b', lines: [], yieldQuantity: '2', yieldUnitId: 'kg' });

    // Litre is a different family from kilogram.
    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '1.0000', quantityUnitId: 'l' }],
      }),
    ).rejects.toThrow(/do not share a base unit/);
  });

  it('accepts a sub-recipe line in a convertible sibling unit', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-a' });
    menuItems.seed({ id: 'mi-b' });
    recipes.seed({ id: 'r-b', menuItemId: 'mi-b', lines: [], yieldQuantity: '2', yieldUnitId: 'kg' });

    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '500.0000', quantityUnitId: 'g' }],
      }),
    ).resolves.toBeDefined();
  });

  it('requires a unit on a sub-recipe line', async () => {
    const { service, menuItems, recipes } = build();
    menuItems.seed({ id: 'mi-a' });
    menuItems.seed({ id: 'mi-b' });
    recipes.seed({ id: 'r-b', menuItemId: 'mi-b', lines: [], yieldQuantity: '2', yieldUnitId: 'kg' });

    await expect(
      service.createRecipe(requestFor(), 'mi-a', {
        lines: [{ subRecipeId: 'r-b', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/must specify quantityUnitId/);
  });

  it('AC: yieldQuantity and yieldUnitId are both-or-neither', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        yieldQuantity: '2',
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/must be provided together/);

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        yieldUnitId: 'kg',
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/must be provided together/);
  });

  it('rejects a zero or negative yield', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        yieldQuantity: '0',
        yieldUnitId: 'kg',
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/greater than zero/);
  });

  it('rejects a yield unit from another outlet', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        yieldQuantity: '2',
        yieldUnitId: 'foreign-kg',
        lines: [{ itemId: 'item-a', quantity: '1.0000' }],
      }),
    ).rejects.toThrow(/different outlet/);
  });

  it('rejects quantityUnitId on a raw-ingredient line', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    // A raw ingredient is always in its own stocking unit; accepting a unit
    // here would imply a conversion that never happens.
    await expect(
      service.createRecipe(requestFor(), 'mi-1', {
        lines: [{ itemId: 'item-a', quantity: '1.0000', quantityUnitId: 'kg' }],
      }),
    ).rejects.toThrow(/sub-recipe lines only/);
  });

  it('persists the yield on the created version', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    const recipe = await service.createRecipe(requestFor(), 'mi-1', {
      yieldQuantity: '2.5000',
      yieldUnitId: 'kg',
      lines: [{ itemId: 'item-a', quantity: '1.0000' }],
    });

    expect(recipe.yieldQuantity).toBe('2.5000');
    expect(recipe.yieldUnitId).toBe('kg');
  });

  it('leaves yield null when omitted, so legacy-shaped recipes stay creatable', async () => {
    const { service, menuItems, items } = build();
    menuItems.seed({ id: 'mi-1' });
    items.seed('item-a');

    const recipe = await service.createRecipe(requestFor(), 'mi-1', {
      lines: [{ itemId: 'item-a', quantity: '1.0000' }],
    });

    expect(recipe.yieldQuantity).toBeNull();
    expect(recipe.yieldUnitId).toBeNull();
  });
});
