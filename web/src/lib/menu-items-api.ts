import { apiClient } from './api-client';

export interface ApiMenuItem {
  id: string;
  outletId: string;
  name: string;
  isActive: boolean;
  /** FR-06: one of this menu item's recipe versions is consumed as a
   * sub-recipe but has no yield, so sales deducting through it are
   * approximate. Drives the "Needs yield" badge. */
  needsYield: boolean;
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

export interface MenuItemFilters {
  outletId?: string;
  isActive?: boolean;
  search?: string;
}

function buildQuery(filters: MenuItemFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const menuItemsApi = {
  list: (filters: MenuItemFilters = {}) => apiClient.get<ApiMenuItem[]>(`/menu-items${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiMenuItem>(`/menu-items/${id}`),
  currentRecipe: (id: string) => apiClient.get<ApiRecipe>(`/menu-items/${id}/recipes/current`),
  recipeHistory: (id: string) => apiClient.get<ApiRecipe[]>(`/menu-items/${id}/recipes/history`),
  cost: (id: string, version?: number) =>
    apiClient.get<ApiRecipeCost>(`/menu-items/${id}/cost${version === undefined ? '' : `?version=${version}`}`),
};
