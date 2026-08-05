import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MENU_ITEM_REPOSITORY, RECIPE_REPOSITORY } from '../repositories/tokens';
import { MenuItemRepository } from '../repositories/menu-item.repository';
import { RecipeRepository, CreateRecipeLineInput } from '../repositories/recipe.repository';
import { ITEM_REPOSITORY, UNIT_OF_MEASURE_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { UnitOfMeasureRepository } from '../../items/repositories/unit-of-measure.repository';
import { convertUnitQuantity } from '../../items/lib/convert-unit';
import { RECIPE_PRECISION } from '../lib/precision';
import { MenuItem } from '../domain/menu-item.entity';
import { Recipe, RecipeLine } from '../domain/recipe.entity';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { CreateRecipeDto } from '../dto/create-recipe.dto';
import { QueryMenuItemsDto } from '../dto/query-menu-items.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import {
  assertNoCycles,
  CircularRecipeError,
  findPathIntoGroup,
  MissingSubRecipeError,
  type LineLookup,
  type ResolvableLine,
} from '../lib/resolve-recipe-tree';

// Matches Item/Category/Supplier's role set (operational master data) rather
// than the narrower CHAIN_OWNER/PROPERTY_MANAGER used for tax/currency — a
// head chef maintaining recipes is exactly the OUTLET_MANAGER case. CHEF is
// included here and nowhere else in the codebase: FR-00 lists it as a role
// precisely for this kind of work.
const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'CHEF'] as const;

export interface MenuItemWithYieldStatus extends MenuItem {
  /** True when one of this menu item's recipe versions is consumed as a
   * sub-recipe but has no yield — so any sale deducting through it is
   * approximate. Drives the "Needs yield" badge. */
  needsYield: boolean;
}

@Injectable()
export class RecipesService {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(RECIPE_REPOSITORY) private readonly recipeRepository: RecipeRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository,
  ) {}

  // ---------------------------------------------------------------- menu items

  async createMenuItem(request: RequestWithAccess, dto: CreateMenuItemDto): Promise<MenuItem> {
    assertOutletAccess(request, dto.outletId, [...MUTATE_ROLES]);

    const existing = await this.menuItemRepository.findByOutletAndName(dto.outletId, dto.name);
    if (existing) {
      throw new ConflictException(`A menu item named "${dto.name}" already exists in this outlet`);
    }
    // isActive defaults false at the schema level — a menu item is not
    // sellable until it has a recipe and someone activates it explicitly.
    return this.menuItemRepository.create({ outletId: dto.outletId, name: dto.name });
  }

  async listMenuItems(request: RequestWithAccess, query: QueryMenuItemsDto): Promise<MenuItem[]> {
    return this.menuItemRepository.findScoped({
      accessibleOutletIds: request.effectiveOutletIds ?? [],
      outletId: query.outletId,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      search: query.search,
    });
  }

  async getMenuItem(request: RequestWithAccess, id: string): Promise<MenuItem> {
    const menuItem = await this.getMenuItemOrThrow(id);
    assertOutletAccess(request, menuItem.outletId);
    return menuItem;
  }

  /**
   * List/detail as the screens consume them, with FR-06's "Needs yield"
   * flag attached.
   *
   * Kept separate from the plain `listMenuItems`/`getMenuItem` above rather
   * than folded into them: those two feed audit-log before/after snapshots,
   * and a derived, non-persisted field appearing in a change diff would read
   * as a data change that never happened.
   *
   * Resolved in one repository call for the whole page, not per row.
   */
  async listMenuItemsWithYieldStatus(
    request: RequestWithAccess,
    query: QueryMenuItemsDto,
  ): Promise<MenuItemWithYieldStatus[]> {
    const menuItems = await this.listMenuItems(request, query);
    const needsYield = new Set(
      await this.menuItemRepository.findIdsNeedingYield(menuItems.map((menuItem) => menuItem.id)),
    );
    return menuItems.map((menuItem) => ({ ...menuItem, needsYield: needsYield.has(menuItem.id) }));
  }

  async getMenuItemWithYieldStatus(
    request: RequestWithAccess,
    id: string,
  ): Promise<MenuItemWithYieldStatus> {
    const menuItem = await this.getMenuItem(request, id);
    const needsYield = await this.menuItemRepository.findIdsNeedingYield([id]);
    return { ...menuItem, needsYield: needsYield.length > 0 };
  }

  async updateMenuItem(
    request: RequestWithAccess,
    id: string,
    dto: UpdateMenuItemDto,
  ): Promise<MenuItem> {
    const menuItem = await this.getMenuItemOrThrow(id);
    assertOutletAccess(request, menuItem.outletId, [...MUTATE_ROLES]);

    if (dto.name && dto.name !== menuItem.name) {
      const clash = await this.menuItemRepository.findByOutletAndName(menuItem.outletId, dto.name);
      if (clash) {
        throw new ConflictException(`A menu item named "${dto.name}" already exists in this outlet`);
      }
    }
    return this.menuItemRepository.update(id, dto);
  }

  /**
   * Spec: `PATCH /menu-items/:id/activate` → 409 if no recipe exists. Also
   * rejects a recipe with zero lines, per the third acceptance criterion —
   * "no recipe" and "an empty recipe" are the same thing operationally, and
   * checking only the former would let an empty one through.
   */
  async activateMenuItem(request: RequestWithAccess, id: string): Promise<MenuItem> {
    const menuItem = await this.getMenuItemOrThrow(id);
    assertOutletAccess(request, menuItem.outletId, [...MUTATE_ROLES]);

    const current = await this.recipeRepository.findCurrentByMenuItemId(id);
    if (!current) {
      throw new ConflictException('Cannot activate a menu item that has no recipe');
    }
    if (current.lines.length === 0) {
      throw new ConflictException('Cannot activate a menu item whose recipe has no lines');
    }
    return this.menuItemRepository.update(id, { isActive: true });
  }

  async deactivateMenuItem(request: RequestWithAccess, id: string): Promise<MenuItem> {
    const menuItem = await this.getMenuItemOrThrow(id);
    assertOutletAccess(request, menuItem.outletId, [...MUTATE_ROLES]);
    return this.menuItemRepository.update(id, { isActive: false });
  }

  // ------------------------------------------------------------------- recipes

  /**
   * Creates the next version. Never mutates the previous Recipe row — the old
   * version stays queryable through /recipes/history so a Sale that recorded
   * `recipeVersionUsed: 1` can still be costed against exactly what version 1
   * contained.
   */
  async createRecipe(
    request: RequestWithAccess,
    menuItemId: string,
    dto: CreateRecipeDto,
  ): Promise<Recipe> {
    const menuItem = await this.getMenuItemOrThrow(menuItemId);
    assertOutletAccess(request, menuItem.outletId, [...MUTATE_ROLES]);

    const { yieldQuantity, yieldUnitId } = await this.validateYield(menuItem, dto);
    const lines = await this.validateLines(menuItem, dto);
    const nextVersion = (await this.recipeRepository.maxVersionForMenuItem(menuItemId)) + 1;

    return this.recipeRepository.createVersion({
      menuItemId,
      version: nextVersion,
      yieldQuantity,
      yieldUnitId,
      lines,
    });
  }

  /**
   * FR-05 yield amendment: `yieldQuantity` and `yieldUnitId` are both-or-
   * neither, the quantity must be > 0, and the unit must belong to the same
   * outlet as the menu item (a yield unit from another outlet would let a
   * conversion cross the tenancy boundary).
   */
  private async validateYield(
    menuItem: MenuItem,
    dto: CreateRecipeDto,
  ): Promise<{ yieldQuantity: string | null; yieldUnitId: string | null }> {
    const hasQuantity = dto.yieldQuantity !== undefined;
    const hasUnit = dto.yieldUnitId !== undefined;

    if (hasQuantity !== hasUnit) {
      throw new BadRequestException(
        'yieldQuantity and yieldUnitId must be provided together, or not at all',
      );
    }
    if (!hasQuantity) return { yieldQuantity: null, yieldUnitId: null };

    if (Number(dto.yieldQuantity) <= 0) {
      throw new BadRequestException('yieldQuantity must be greater than zero');
    }

    const unit = await this.unitRepository.findById(dto.yieldUnitId!);
    if (!unit) throw new BadRequestException(`Yield unit ${dto.yieldUnitId} not found`);
    if (unit.outletId !== menuItem.outletId) {
      throw new BadRequestException(
        `Yield unit ${dto.yieldUnitId} belongs to a different outlet than this menu item`,
      );
    }

    return { yieldQuantity: dto.yieldQuantity!, yieldUnitId: dto.yieldUnitId! };
  }

  async getCurrentRecipe(request: RequestWithAccess, menuItemId: string): Promise<Recipe> {
    const menuItem = await this.getMenuItemOrThrow(menuItemId);
    assertOutletAccess(request, menuItem.outletId);

    const current = await this.recipeRepository.findCurrentByMenuItemId(menuItemId);
    if (!current) throw new NotFoundException('This menu item has no recipe yet');
    return current;
  }

  async getRecipeHistory(request: RequestWithAccess, menuItemId: string): Promise<Recipe[]> {
    const menuItem = await this.getMenuItemOrThrow(menuItemId);
    assertOutletAccess(request, menuItem.outletId);
    return this.recipeRepository.findAllByMenuItemId(menuItemId);
  }

  // ----------------------------------------------------------------- internals

  private async getMenuItemOrThrow(id: string): Promise<MenuItem> {
    const menuItem = await this.menuItemRepository.findById(id);
    if (!menuItem) throw new NotFoundException(`Menu item ${id} not found`);
    return menuItem;
  }

  /**
   * Validates the submitted lines and returns them in repository shape.
   *
   * Runs before any write, so a rejected recipe leaves no partial version
   * behind — which matters more here than usual, because versions are
   * append-only and a junk version could never be deleted, only superseded.
   */
  private async validateLines(
    menuItem: MenuItem,
    dto: CreateRecipeDto,
  ): Promise<CreateRecipeLineInput[]> {
    const lines: CreateRecipeLineInput[] = [];

    for (const [index, line] of dto.lines.entries()) {
      const hasItem = !!line.itemId;
      const hasSubRecipe = !!line.subRecipeId;
      if (hasItem === hasSubRecipe) {
        throw new BadRequestException(
          `Line ${index + 1}: exactly one of itemId or subRecipeId must be set, not ${hasItem ? 'both' : 'neither'}`,
        );
      }
      if (Number(line.quantity) <= 0) {
        throw new BadRequestException(`Line ${index + 1}: quantity must be greater than zero`);
      }
      if (line.itemId && line.quantityUnitId) {
        throw new BadRequestException(
          `Line ${index + 1}: quantityUnitId applies to sub-recipe lines only — a raw ingredient uses its own stocking unit`,
        );
      }
      lines.push({
        itemId: line.itemId ?? null,
        subRecipeId: line.subRecipeId ?? null,
        quantity: line.quantity,
        quantityUnitId: line.quantityUnitId ?? null,
      });
    }

    await this.assertIngredientsInSameOutlet(menuItem, lines);
    await this.assertSubRecipeYieldsUsable(menuItem, lines);
    await this.assertNoSubRecipeCycles(menuItem, lines);
    return lines;
  }

  /**
   * FR-05 yield amendment, the two rules that need the *child* recipe in hand:
   *
   * - A recipe with no yield cannot be referenced as a sub-recipe at all
   *   (409). This is what closes off the ambiguous batch-multiplier style for
   *   new data, while leaving existing rows alone.
   * - The line's unit must share a base unit with the child's yield unit
   *   (400), reusing FR-01's own unrelated-family rejection rather than
   *   re-deriving it.
   */
  private async assertSubRecipeYieldsUsable(
    menuItem: MenuItem,
    lines: CreateRecipeLineInput[],
  ): Promise<void> {
    const subRecipeIds = [
      ...new Set(lines.map((l) => l.subRecipeId).filter((id): id is string => !!id)),
    ];
    if (subRecipeIds.length === 0) return;

    for (const line of lines) {
      if (!line.subRecipeId) continue;

      const child = await this.recipeRepository.findById(line.subRecipeId);
      if (!child) throw new BadRequestException(`Sub-recipe ${line.subRecipeId} not found`);

      if (child.yieldQuantity === null || child.yieldUnitId === null) {
        throw new ConflictException(
          `Sub-recipe ${line.subRecipeId} has no yield set, so the quantity used cannot be resolved. ` +
            'Set a yield quantity and unit on that recipe before referencing it.',
        );
      }

      if (!line.quantityUnitId) {
        throw new BadRequestException(
          `A sub-recipe line must specify quantityUnitId — the unit its quantity is expressed in`,
        );
      }

      const [lineUnit, yieldUnit] = await Promise.all([
        this.unitRepository.findById(line.quantityUnitId),
        this.unitRepository.findById(child.yieldUnitId),
      ]);
      if (!lineUnit) throw new BadRequestException(`Unit ${line.quantityUnitId} not found`);
      if (!yieldUnit) throw new BadRequestException(`Unit ${child.yieldUnitId} not found`);
      if (lineUnit.outletId !== menuItem.outletId) {
        throw new BadRequestException(
          `Unit ${line.quantityUnitId} belongs to a different outlet than this menu item`,
        );
      }

      try {
        // Only the compatibility check matters here; the value is discarded.
        // Doing it now means a mismatched unit family is a save-time 400
        // rather than a surprise when the recipe is first costed.
        convertUnitQuantity('1', lineUnit, yieldUnit, RECIPE_PRECISION);
      } catch {
        throw new BadRequestException(
          `Unit ${lineUnit.abbreviation} cannot be converted to the sub-recipe's yield unit ${yieldUnit.abbreviation} — they do not share a base unit`,
        );
      }
    }
  }

  /**
   * A recipe may only consume ingredients and sub-recipes belonging to its own
   * outlet. Without this, a caller with access to two outlets could build a
   * recipe in outlet A that silently deducts stock from outlet B on every
   * sale — a tenancy leak that the route-level scope check can't catch,
   * because the request itself is legitimately scoped to both.
   */
  private async assertIngredientsInSameOutlet(
    menuItem: MenuItem,
    lines: CreateRecipeLineInput[],
  ): Promise<void> {
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))];
    for (const itemId of itemIds) {
      const item = await this.itemRepository.findById(itemId);
      if (!item) throw new BadRequestException(`Ingredient item ${itemId} not found`);
      if (item.outletId !== menuItem.outletId) {
        throw new BadRequestException(
          `Ingredient item ${itemId} belongs to a different outlet than this menu item`,
        );
      }
    }

    const subRecipeIds = [
      ...new Set(lines.map((l) => l.subRecipeId).filter((id): id is string => !!id)),
    ];
    if (subRecipeIds.length === 0) return;

    const menuItemIdByRecipe =
      await this.recipeRepository.findMenuItemIdsForRecipeIds(subRecipeIds);
    for (const subRecipeId of subRecipeIds) {
      const ownerMenuItemId = menuItemIdByRecipe.get(subRecipeId);
      if (!ownerMenuItemId) throw new BadRequestException(`Sub-recipe ${subRecipeId} not found`);

      const owner = await this.menuItemRepository.findById(ownerMenuItemId);
      if (!owner || owner.outletId !== menuItem.outletId) {
        throw new BadRequestException(
          `Sub-recipe ${subRecipeId} belongs to a different outlet than this menu item`,
        );
      }
    }
  }

  /**
   * Cycle check at save time, per the spec's "A contains B contains A".
   *
   * Two distinct checks, because version-pinning makes them different things:
   *
   * 1. Menu-item level (the one that actually fires). A sub-recipe line pins a
   *    specific Recipe *version*, and a version can only reference rows that
   *    already existed, so the recipe-id graph is a DAG by construction — a
   *    literal id cycle can't be created through this API. What a user *can*
   *    do is give dish A a recipe that transitively reaches an older version
   *    of dish A. That terminates arithmetically, so an id-cycle check would
   *    wave it through, but it's the same modelling error the spec names and
   *    it produces nonsense costs. Rejected here.
   *
   * 2. Recipe-id level, over the stored data being pulled in. Unreachable via
   *    this endpoint, kept as a guard against rows written out of band (a
   *    manual SQL fix, a future import) turning a cost request into a hang.
   */
  private async assertNoSubRecipeCycles(
    menuItem: MenuItem,
    lines: CreateRecipeLineInput[],
  ): Promise<void> {
    const pendingLines: ResolvableLine[] = lines.map((line) => ({
      itemId: line.itemId ?? null,
      subRecipeId: line.subRecipeId ?? null,
      quantity: line.quantity,
      quantityUnitId: line.quantityUnitId ?? null,
    }));

    const subRecipeIds = lines.map((l) => l.subRecipeId).filter((id): id is string => !!id);
    if (subRecipeIds.length === 0) return;

    const { linesByRecipe, menuItemByRecipe } = await this.loadSubtree(subRecipeIds);
    const lookup: LineLookup = (recipeId) => linesByRecipe.get(recipeId);

    // (1) Does anything in the tree belong to the menu item being saved?
    const path = findPathIntoGroup(
      pendingLines,
      lookup,
      (recipeId) => menuItemByRecipe.get(recipeId),
      menuItem.id,
    );
    if (path) {
      const names = await this.describeChain(path, menuItemByRecipe);
      throw new BadRequestException(
        `Circular sub-recipe reference: ${[menuItem.name, ...names].join(' -> ')}. ` +
          'A recipe cannot contain itself, directly or indirectly.',
      );
    }

    // (2) Defensive: a genuine id cycle in stored data.
    for (const rootId of new Set(subRecipeIds)) {
      try {
        assertNoCycles(rootId, lookup);
      } catch (error) {
        if (error instanceof CircularRecipeError) {
          throw new BadRequestException(
            `Circular sub-recipe reference in stored recipe data: ${error.cycle.join(' -> ')}.`,
          );
        }
        if (error instanceof MissingSubRecipeError) {
          throw new BadRequestException(`Sub-recipe ${error.recipeId} not found`);
        }
        throw error;
      }
    }
  }

  /** Turns a recipe-id path into menu-item names for a readable error. */
  private async describeChain(
    recipeIds: string[],
    menuItemByRecipe: Map<string, string>,
  ): Promise<string[]> {
    const names: string[] = [];
    for (const recipeId of recipeIds) {
      const menuItemId = menuItemByRecipe.get(recipeId);
      const owner = menuItemId ? await this.menuItemRepository.findById(menuItemId) : null;
      names.push(owner?.name ?? recipeId);
    }
    return names;
  }

  /**
   * Breadth-first load of every recipe reachable from the given roots, plus
   * which menu item each belongs to, so both cycle checks run against an
   * in-memory map rather than issuing a query per node. Already-loaded ids are
   * never re-fetched, so a pre-existing cycle in stored data terminates this
   * loop instead of hanging it — the checker then reports it properly.
   */
  private async loadSubtree(rootIds: string[]): Promise<{
    linesByRecipe: Map<string, RecipeLine[]>;
    menuItemByRecipe: Map<string, string>;
  }> {
    const linesByRecipe = new Map<string, RecipeLine[]>();
    const menuItemByRecipe = new Map<string, string>();
    let frontier = [...new Set(rootIds)];

    while (frontier.length > 0) {
      const [batch, owners] = await Promise.all([
        this.recipeRepository.findLinesForRecipeIds(frontier),
        this.recipeRepository.findMenuItemIdsForRecipeIds(frontier),
      ]);
      const next: string[] = [];
      for (const [recipeId, recipeLines] of batch) {
        linesByRecipe.set(recipeId, recipeLines);
        const owner = owners.get(recipeId);
        if (owner) menuItemByRecipe.set(recipeId, owner);
        for (const line of recipeLines) {
          if (line.subRecipeId && !linesByRecipe.has(line.subRecipeId)) next.push(line.subRecipeId);
        }
      }
      // Ids in `frontier` that came back missing stay absent from the maps,
      // which the tree walk surfaces as MissingSubRecipeError.
      frontier = [...new Set(next)];
    }
    return { linesByRecipe, menuItemByRecipe };
  }
}
