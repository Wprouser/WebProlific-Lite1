import { apiClient } from './api-client';

export interface ApiSupplier {
  id: string;
  outletId: string;
  supplierCode: string | null;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  stateOrProvince: string | null;
  countryCode: string | null;
  postalCode: string | null;
  preferredCurrency: string | null;
  taxRegistrationType: string | null;
  taxRegistrationNumber: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfscOrSwift: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSupplierPriceHistory {
  id: string;
  supplierId: string;
  itemId: string;
  price: string;
  currencyCode: string;
  // null only for a row recorded before this column existed.
  priceInBaseCurrency: string | null;
  recordedAt: string;
  source: 'PO' | 'GRN' | 'MANUAL';
}

export interface ApiSupplierPerformance {
  totalGrns: number;
  onTimeRate: number | null;
  priceConsistencyScore: number | null;
}

export interface SupplierFilters {
  outletId?: string;
  isActive?: boolean;
  search?: string;
}

export interface CreateSupplierInput {
  outletId: string;
  supplierCode?: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  stateOrProvince?: string;
  countryCode?: string;
  postalCode?: string;
  preferredCurrency?: string;
  taxRegistrationType?: string;
  taxRegistrationNumber?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfscOrSwift?: string;
}

export type UpdateSupplierInput = Partial<Omit<CreateSupplierInput, 'outletId'>> & { isActive?: boolean };

function buildQuery(filters: SupplierFilters): string {
  const params = new URLSearchParams();
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-03's Supplier Management — outlet-scoped master data, same relationship
 * to Item/PO/GRN that Category management has to Items. */
export const suppliersApi = {
  list: (filters: SupplierFilters = {}) => apiClient.get<ApiSupplier[]>(`/suppliers${buildQuery(filters)}`),
  get: (id: string) => apiClient.get<ApiSupplier>(`/suppliers/${id}`),
  create: (input: CreateSupplierInput) => apiClient.post<ApiSupplier>('/suppliers', input),
  update: (id: string, input: UpdateSupplierInput) => apiClient.patch<ApiSupplier>(`/suppliers/${id}`, input),
  deactivate: (id: string) => apiClient.delete<ApiSupplier>(`/suppliers/${id}`),
  priceHistory: (id: string, itemId?: string) =>
    apiClient.get<ApiSupplierPriceHistory[]>(`/suppliers/${id}/price-history${itemId ? `?itemId=${itemId}` : ''}`),
  performance: (id: string) => apiClient.get<ApiSupplierPerformance>(`/suppliers/${id}/performance`),
};
