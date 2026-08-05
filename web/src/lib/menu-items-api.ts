import { apiClient } from './api-client';

export interface ApiMenuItem {
  id: string;
  outletId: string;
  name: string;
  isActive: boolean;
  /** Null when no recipe exists yet. */
  currentVersion: number | null;
  /**
   * One of this menu item's recipe versions is consumed as a sub-recipe but
   * has no yield, so sales deducting through it are approximate. This is the
   * row to *fix*.
   */
  needsYield: boolean;
  /**
   * This item's own cost traverses such a recipe somewhere below it. Not
   * itself actionable — the fix lives on whichever row has `needsYield` —
   * but it explains why the number shown is soft. Only meaningful when the
   * list was fetched with `includeCost`.
   */
  costUsesLegacyRecipe: boolean;
  /** Null unless `includeCost` was requested, or the recipe can't be costed. */
  totalCost: string | null;
}

/** A recipe that may legally be used as a sub-recipe — it has a yield. */
export interface ApiSubRecipeCandidate {
  menuItemId: string;
  menuItemName: string;
  recipeId: string;
  version: number;
  yieldQuantity: string;
  yieldUnitId: string;
}

export interface ApiUsedInEntry {
  parentMenuItemId: string;
  parentMenuItemName: string;
  parentRecipeId: string;
  parentVersion: number;
  referencedVersion: number;
  /** The parent still pins an older version of this recipe. */
  isStale: boolean;
}

export interface ApiRecipeLine {
  id: string;
  recipeId: string;
  itemId: string | null;
  subRecipeId: string | null;
  quantity: string;
  quantityUnitId: string | null;
}

export interface ApiRecipe {
  id: string;
  menuItemId: string;
  version: number;
  isCurrent: boolean;
  yieldQuantity: string | null;
  yieldUnitId: string | null;
  lines: ApiRecipeLine[];
  createdAt: string;
}

export interface ApiRecipeCostComponent {
  itemId: string;
  itemName: string;
  quantity: string;
  unitId: string;
  unitCost: string;
  lineCost: string;
}

export interface ApiRecipeCost {
  menuItemId: string;
  recipeId: string;
  recipeVersion: number;
  totalCost: string;
  components: ApiRecipeCostComponent[];
  usesLegacyBatchMultiplier: boolean;
  legacyRecipeIds: string[];
}

export interface RecipeLineInput {
  itemId?: string;
  subRecipeId?: string;
  quantity: string;
  quantityUnitId?: string;
}

export interface CreateRecipeInput {
  yieldQuantity?: string;
  yieldUnitId?: string;
  lines: RecipeLineInput[];
  /**
   * The version this edit was based on — `0` when the menu item had no recipe
   * yet. The server rejects the save with a 409 if the recipe has been
   * versioned since, instead of letting a save nobody reviewed become the
   * current version. Always sent by the builder.
   */
  basedOnVersion?: number;
}

export interface MenuItemFilters {
  outletId?: string;
  isActive?: boolean;
  search?: string;
  /** One full recipe-tree resolution per row on the server — ask only where
   * the cost is actually shown. */
  includeCost?: boolean;
}

function buildQuery(filters: MenuItemFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.search) params.set('search', filters.search);
  if (filters.includeCost) params.set('includeCost', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const menuItemsApi = {
  list: (filters: MenuItemFilters = {}) => apiClient.get<ApiMenuItem[]>(`/menu-items${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiMenuItem>(`/menu-items/${id}`),
  create: (input: { outletId: string; name: string }) => apiClient.post<ApiMenuItem>('/menu-items', input),
  rename: (id: string, name: string) => apiClient.patch<ApiMenuItem>(`/menu-items/${id}`, { name }),
  activate: (id: string) => apiClient.patch<ApiMenuItem>(`/menu-items/${id}/activate`),
  deactivate: (id: string) => apiClient.patch<ApiMenuItem>(`/menu-items/${id}/deactivate`),

  currentRecipe: (id: string) => apiClient.get<ApiRecipe>(`/menu-items/${id}/recipes/current`),
  recipeHistory: (id: string) => apiClient.get<ApiRecipe[]>(`/menu-items/${id}/recipes/history`),
  /** Auto-versions server-side: this never overwrites the current recipe. */
  saveRecipe: (id: string, input: CreateRecipeInput) =>
    apiClient.post<ApiRecipe>(`/menu-items/${id}/recipes`, input),
  cost: (id: string, version?: number) =>
    apiClient.get<ApiRecipeCost>(`/menu-items/${id}/cost${version === undefined ? '' : `?version=${version}`}`),

  usedIn: (id: string) => apiClient.get<ApiUsedInEntry[]>(`/menu-items/${id}/used-in`),
  /** Only yield-bearing current recipes — a yield-less one is never offered,
   * so the server's 409 becomes unreachable from the UI. */
  subRecipeCandidates: (outletId: string | undefined, excludeMenuItemId?: string) => {
    const params = new URLSearchParams({ subRecipeCandidates: 'true' });
    if (outletId) params.set('outletId', outletId);
    if (excludeMenuItemId) params.set('excludeMenuItemId', excludeMenuItemId);
    return apiClient.get<ApiSubRecipeCandidate[]>(`/menu-items?${params.toString()}`);
  },
};
