import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MENU_ITEM_REPOSITORY, RECIPE_REPOSITORY } from '../repositories/tokens';
import { MenuItemRepository } from '../repositories/menu-item.repository';
import {
  RecipeRepository,
  CreateRecipeLineInput,
  RecipeVersionConflictError,
} from '../repositories/recipe.repository';
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
import { RecipeCostService } from './recipe-cost.service';
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
  /** Null when no recipe exists yet. */
  currentVersion: number | null;
}

/**
 * List row as the screens consume it.
 *
 * `needsYield` and `costUsesLegacyRecipe` are deliberately separate, because
 * they mark different rows and mean different things. `needsYield` is on the
 * recipe that is *missing* a yield — the one row a user opens to fix the
 * problem. `costUsesLegacyRecipe` is on every dish whose cost happens to
 * traverse such a recipe — informative ("this number is soft"), but not
 * itself actionable. Collapsing them into one badge would either hide the
 * fix or scatter it across every dish that inherited the symptom.
 */
export interface MenuItemListRow extends MenuItemWithYieldStatus {
  /** Present only when the caller asked for costs — it is a full recipe-tree
   * resolution per row, not a column read. */
  totalCost: string | null;
  costUsesLegacyRecipe: boolean;
}

export interface SubRecipeCandidate {
  menuItemId: string;
  menuItemName: string;
  recipeId: string;
  version: number;
  /** Non-null by construction — a candidate without a yield isn't one. */
  yieldQuantity: string;
  yieldUnitId: string;
}

export interface UsedInEntry {
  parentMenuItemId: string;
  parentMenuItemName: string;
  parentRecipeId: string;
  parentVersion: number;
  referencedVersion: number;
  /** The parent pins an older version of this recipe than the current one. */
  isStale: boolean;
}

@Injectable()
export class RecipesService {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(RECIPE_REPOSITORY) private readonly recipeRepository: RecipeRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository,
    // One-directional: RecipeCostService knows nothing about this service, so
    // there is no DI cycle to forwardRef around.
    private readonly recipeCostService: RecipeCostService,
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
  ): Promise<MenuItemListRow[]> {
    const menuItems = await this.listMenuItems(request, query);
    const ids = menuItems.map((menuItem) => menuItem.id);
    // Both resolved for the whole page in one call each, not per row.
    const needsYield = new Set(await this.menuItemRepository.findIdsNeedingYield(ids));
    const currents = await this.recipeRepository.findCurrentVersions(ids);

    const rows: MenuItemListRow[] = [];
    for (const menuItem of menuItems) {
      const row: MenuItemListRow = {
        ...menuItem,
        needsYield: needsYield.has(menuItem.id),
        currentVersion: currents.get(menuItem.id)?.version ?? null,
        totalCost: null,
        costUsesLegacyRecipe: false,
      };

      // Opt-in, because this is one full recipe-tree resolution per row —
      // an O(rows x tree depth) cost, not a column read. The list screen asks
      // for it explicitly; nothing else should pay for it by default.
      if (query.includeCost && row.currentVersion !== null) {
        try {
          const cost = await this.recipeCostService.costRecipeVersion(menuItem.id);
          row.totalCost = cost.totalCost;
          row.costUsesLegacyRecipe = cost.usesLegacyBatchMultiplier;
        } catch {
          // A recipe that can't be costed (a deleted ingredient, a stored
          // cycle) must not blank the whole list — the row just shows no
          // cost, and the detail screen reports why.
          row.totalCost = null;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  async getMenuItemWithYieldStatus(
    request: RequestWithAccess,
    id: string,
  ): Promise<MenuItemWithYieldStatus> {
    const menuItem = await this.getMenuItem(request, id);
    const needsYield = await this.menuItemRepository.findIdsNeedingYield([id]);
    const current = (await this.recipeRepository.findCurrentVersions([id])).get(id);
    return {
      ...menuItem,
      needsYield: needsYield.length > 0,
      currentVersion: current?.version ?? null,
    };
  }

  /**
   * Menu items whose *current* recipe has a yield — the only ones another
   * recipe may legally reference as a sub-recipe.
   *
   * The picker on the builder screen is fed from here rather than from the
   * full list, so a yield-less recipe is never selectable in the first place.
   * That turns the spec's 409 into something the user cannot trigger, instead
   * of an error they have to read and undo. The 409 stays in place as the
   * server-side guarantee.
   */
  async listSubRecipeCandidates(
    request: RequestWithAccess,
    query: QueryMenuItemsDto,
    excludeMenuItemId?: string,
  ): Promise<SubRecipeCandidate[]> {
    const menuItems = await this.listMenuItems(request, query);
    const currents = await this.recipeRepository.findCurrentVersions(
      menuItems.map((menuItem) => menuItem.id),
    );

    const candidates: SubRecipeCandidate[] = [];
    for (const menuItem of menuItems) {
      // A recipe can't contain itself, and offering it would only produce the
      // circular-reference rejection.
      if (menuItem.id === excludeMenuItemId) continue;
      const current = currents.get(menuItem.id);
      if (!current || current.yieldQuantity === null || current.yieldUnitId === null) continue;
      candidates.push({
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        recipeId: current.recipeId,
        version: current.version,
        yieldQuantity: current.yieldQuantity,
        yieldUnitId: current.yieldUnitId,
      });
    }
    return candidates;
  }

  /**
   * The reverse lookup behind the "Used In" tab: which recipes currently
   * consume this one, and whether each is pinned to a stale version of it.
   *
   * `isStale` is the visible form of FR-05's non-propagation rule — a parent
   * pins a specific sub-recipe version and keeps resolving against it until
   * the parent itself is re-versioned. Correct for historical accuracy, and
   * exactly the kind of thing that surprises someone who just updated a base
   * sauce and expected every dish to follow.
   */
  async getUsedIn(request: RequestWithAccess, menuItemId: string): Promise<UsedInEntry[]> {
    await this.getMenuItem(request, menuItemId);
    const currentVersion = (await this.recipeRepository.findCurrentVersions([menuItemId])).get(
      menuItemId,
    )?.version;

    const references = await this.recipeRepository.findReferencingRecipes(menuItemId);
    return references.map((reference) => ({
      ...reference,
      isStale: currentVersion !== undefined && reference.referencedVersion !== currentVersion,
    }));
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

    const latestVersion = await this.recipeRepository.maxVersionForMenuItem(menuItemId);
    this.assertNotStale(dto.basedOnVersion, latestVersion);
    const nextVersion = latestVersion + 1;

    try {
      return await this.recipeRepository.createVersion({
        menuItemId,
        version: nextVersion,
        yieldQuantity,
        yieldUnitId,
        lines,
      });
    } catch (error) {
      // Lost the race after passing the check above. Same situation from the
      // user's side, so the same answer.
      if (error instanceof RecipeVersionConflictError) {
        throw new ConflictException(
          'Someone else saved a new version of this recipe while you were saving. ' +
            'Reload to see the current version, then reapply your changes.',
        );
      }
      throw error;
    }
  }

  /**
   * Optimistic concurrency check for the create-or-replace save.
   *
   * Rejects when someone else has versioned this recipe since the caller
   * loaded it. Nothing is ever overwritten — versions are append-only — but
   * without this check the later save still wins in the only sense that
   * matters: it becomes the current version, quietly discarding a colleague's
   * work that the saver never saw. A 409 with both version numbers is the
   * honest answer, since only a human can merge two divergent recipes.
   *
   * Deliberately compares against the *max* version rather than the current
   * one: they are the same today, and if they ever diverge the max is the
   * conservative choice — it still catches a version the caller never saw.
   */
  private assertNotStale(basedOnVersion: number | undefined, latestVersion: number): void {
    if (basedOnVersion === undefined) return; // precondition not supplied — see the DTO.
    if (basedOnVersion === latestVersion) return;

    throw new ConflictException(
      latestVersion === 0
        ? 'This menu item has no recipe yet, but your edit was based on version ' +
          `${basedOnVersion}. Reload and try again.`
        : `This recipe has changed since you opened it — it is now at version ${latestVersion}, ` +
          `but your edit was based on version ${basedOnVersion}. Reload to see the current version, ` +
          'then reapply your changes.',
    );
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
