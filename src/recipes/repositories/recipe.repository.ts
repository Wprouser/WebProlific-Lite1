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
}
