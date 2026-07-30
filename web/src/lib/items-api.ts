import { apiClient } from './api-client';

export interface ApiCategory {
  id: string;
  name: string;
  outletId: string;
}

export interface ApiUnitOfMeasure {
  id: string;
  outletId: string;
  name: string;
  abbreviation: string;
  // null = this unit IS a base unit. Non-null = converts to that base unit
  // at conversionFactor (see the Technical Spec's flat, two-level-only
  // hierarchy rule — a derived unit can never point to another derived one).
  baseUnitId: string | null;
  conversionFactor: string | null;
  isActive: boolean;
}

export interface ApiItem {
  id: string;
  outletId: string;
  name: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  unitId: string;
  minStock: string;
  maxStock: string;
  currentStock: string;
  shelfLifeDays: number | null;
  // Omitted entirely (not just empty) in the response body for CHEF users —
  // see FieldRestrictionInterceptor. Never assume it's present.
  costPrice?: string;
  defaultSupplierId: string | null;
  purchaseGLAccount: string | null;
  defaultTaxRateId: string | null;
  storageLocation: string | null;
  isActive: boolean;
}

export interface ApiItemImage {
  id: string;
  itemId: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ItemFilters {
  categoryId?: string;
  isActive?: boolean;
  search?: string;
  belowMinStock?: boolean;
}

export interface OpeningStockInput {
  quantity: string;
  ratePerUnit?: string;
}

export interface CreateItemInput {
  outletId: string;
  name: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  unitId: string;
  minStock: string;
  maxStock: string;
  shelfLifeDays: number | null;
  costPrice: string;
  defaultSupplierId: string | null;
  purchaseGLAccount: string | null;
  defaultTaxRateId: string | null;
  storageLocation: string | null;
  // Captured at creation time only — see FR-01 spec's Business Logic.
  openingStock?: OpeningStockInput;
}

export type UpdateItemInput = Partial<Omit<CreateItemInput, 'outletId' | 'openingStock'>>;

function buildQuery(filters: ItemFilters): string {
  const params = new URLSearchParams();
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.search) params.set('search', filters.search);
  if (filters.belowMinStock) params.set('belowMinStock', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const itemsApi = {
  list: (filters: ItemFilters) => apiClient.get<ApiItem[]>(`/items${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiItem>(`/items/${id}`),
  create: (input: CreateItemInput) => apiClient.post<ApiItem>('/items', input),
  update: (id: string, input: UpdateItemInput) => apiClient.patch<ApiItem>(`/items/${id}`, input),
  deactivate: (id: string) => apiClient.delete<ApiItem>(`/items/${id}`),
  reactivate: (id: string) => apiClient.patch<ApiItem>(`/items/${id}`, { isActive: true }),
  clone: (id: string, sku: string) => apiClient.post<ApiItem>(`/items/${id}/clone`, { sku }),
};

export const categoriesApi = {
  list: () => apiClient.get<ApiCategory[]>('/items/categories'),
  create: (name: string, outletId: string) => apiClient.post<ApiCategory>('/items/categories', { name, outletId }),
};

export interface UnitFilters {
  outletId?: string;
  isActive?: boolean;
}

function buildUnitQuery(filters: UnitFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface CreateUnitOfMeasureInput {
  name: string;
  abbreviation: string;
  outletId: string;
  baseUnitId?: string;
  conversionFactor?: string;
}

export type UpdateUnitOfMeasureInput = Partial<{
  name: string;
  abbreviation: string;
  isActive: boolean;
  // Explicit null clears an existing conversion relationship.
  baseUnitId: string | null;
  conversionFactor: string | null;
}>;

export const unitsApi = {
  list: (filters: UnitFilters = {}) => apiClient.get<ApiUnitOfMeasure[]>(`/items/units${buildUnitQuery(filters)}`),
  create: (input: CreateUnitOfMeasureInput) => apiClient.post<ApiUnitOfMeasure>('/items/units', input),
  update: (id: string, input: UpdateUnitOfMeasureInput) =>
    apiClient.patch<ApiUnitOfMeasure>(`/items/units/${id}`, input),
  deactivate: (id: string) => apiClient.delete<ApiUnitOfMeasure>(`/items/units/${id}`),
};

export const itemImagesApi = {
  list: (itemId: string) => apiClient.get<ApiItemImage[]>(`/items/${itemId}/images`),
  upload: (itemId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.postForm<ApiItemImage>(`/items/${itemId}/images`, formData);
  },
  setPrimary: (itemId: string, imageId: string) =>
    apiClient.patch<ApiItemImage>(`/items/${itemId}/images/${imageId}/primary`, undefined),
  delete: (itemId: string, imageId: string) => apiClient.delete<{ deleted: true }>(`/items/${itemId}/images/${imageId}`),
};
