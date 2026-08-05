import { Recipe } from '../domain/recipe.entity';

export interface CreateRecipeLineInput {
  itemId?: string | null;
  subRecipeId?: string | null;
  quantity: string;
  quantityUnitId?: string | null;
}

export interface CreateRecipeInput {
  menuItemId: string;
  version: number;
  yieldQuantity?: string | null;
  yieldUnitId?: string | null;
  lines: CreateRecipeLineInput[];
}

/**
 * Two saves raced past the service's version check and collided on
 * `@@unique([menuItemId, version])`.
 *
 * The check above narrows that window; this closes it. A plain domain error
 * rather than an HTTP exception, so the repository layer stays free of Nest —
 * RecipesService translates it into the same 409 a stale save gets, because
 * from the user's side it is the same situation.
 */
export class RecipeVersionConflictError extends Error {
  constructor(readonly menuItemId: string, readonly version: number) {
    super(`Version ${version} of menu item ${menuItemId}'s recipe already exists`);
    this.name = 'RecipeVersionConflictError';
  }
}

export abstract class RecipeRepository {
  /**
   * Inserts a new version and clears `isCurrent` on the menu item's previous
   * versions in one transaction. Never updates an existing Recipe row's lines
   * — FR-05 forbids overwriting, since past sales are costed by version.
   */
  abstract createVersion(data: CreateRecipeInput): Promise<Recipe>;

  abstract findById(id: string): Promise<Recipe | null>;
  abstract findCurrentByMenuItemId(menuItemId: string): Promise<Recipe | null>;
  abstract findAllByMenuItemId(menuItemId: string): Promise<Recipe[]>;
  abstract findByMenuItemIdAndVersion(menuItemId: string, version: number): Promise<Recipe | null>;
  abstract maxVersionForMenuItem(menuItemId: string): Promise<number>;

  /**
   * Bulk line fetch for sub-recipe resolution — the tree walk needs many
   * recipes' lines at once, and issuing one query per node would turn a
   * nested recipe into an N+1 storm.
   */
  abstract findLinesForRecipeIds(recipeIds: string[]): Promise<Map<string, Recipe['lines']>>;

  /** Menu item ids for a set of recipe ids — used to scope-check sub-recipes. */
  abstract findMenuItemIdsForRecipeIds(recipeIds: string[]): Promise<Map<string, string>>;

  /**
   * Every *current* recipe that consumes one of this menu item's recipe
   * versions as a sub-recipe.
   *
   * Restricted to current parents deliberately: a superseded parent version
   * still holds a row pointing here, but nothing sells through it any more,
   * so listing it would inflate the blast radius the "Used In" tab exists to
   * report. `referencedVersion` is the sub-recipe version each parent pinned,
   * which is what makes the stale-reference indicator possible.
   */
  abstract findReferencingRecipes(menuItemId: string): Promise<SubRecipeReference[]>;

  /** Which of these menu items have a *current* recipe with a yield set —
   * i.e. the only ones legally selectable as a sub-recipe. */
  abstract findCurrentVersions(menuItemIds: string[]): Promise<Map<string, CurrentRecipeSummary>>;
}

export interface SubRecipeReference {
  /** The parent that references this one. */
  parentMenuItemId: string;
  parentMenuItemName: string;
  parentRecipeId: string;
  parentVersion: number;
  /** The version of *this* menu item's recipe that the parent pinned. */
  referencedVersion: number;
}

export interface CurrentRecipeSummary {
  recipeId: string;
  version: number;
  yieldQuantity: string | null;
  yieldUnitId: string | null;
}
