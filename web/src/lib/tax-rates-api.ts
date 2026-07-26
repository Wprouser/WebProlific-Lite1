import { apiClient } from './api-client';

export interface ApiTaxRateComponent {
  id: string;
  taxRateId: string;
  componentName: string;
  componentRate: string;
}

export interface ApiTaxRate {
  id: string;
  outletId: string;
  name: string;
  ratePercent: string;
  isCompound: boolean;
  isDefault: boolean;
  isActive: boolean;
  countryCode: string | null;
  components: ApiTaxRateComponent[];
}

export interface TaxRateFilters {
  isActive?: boolean;
}

export interface TaxRateComponentInput {
  componentName: string;
  componentRate: string;
}

export interface CreateTaxRateInput {
  outletId: string;
  name: string;
  ratePercent: string;
  isCompound?: boolean;
  countryCode?: string;
  components?: TaxRateComponentInput[];
}

export type UpdateTaxRateInput = Partial<Omit<CreateTaxRateInput, 'outletId' | 'countryCode'>>;

export interface TaxRatePreviewResult {
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  components: { componentName: string; componentRate: string; componentAmount: string }[];
}

function buildQuery(filters: TaxRateFilters): string {
  const params = new URLSearchParams();
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** FR-04's Tax Configuration Screen — outlet-level shared reference data,
 * managed from its own standalone screen and consumed identically by the
 * Item Master's default-tax dropdown (and, once built, PO/GRN line
 * selectors) via this same GET /tax-rates list. */
export const taxRatesApi = {
  list: (filters: TaxRateFilters = {}) => apiClient.get<ApiTaxRate[]>(`/tax-rates${buildQuery(filters)}`),
  create: (input: CreateTaxRateInput) => apiClient.post<ApiTaxRate>('/tax-rates', input),
  update: (id: string, input: UpdateTaxRateInput) => apiClient.patch<ApiTaxRate>(`/tax-rates/${id}`, input),
  deactivate: (id: string) => apiClient.delete<ApiTaxRate>(`/tax-rates/${id}`),
  /** Demo/preview utility — no real PO/GRN line exists yet to apply tax to
   * (FR-03/04 aren't built), so this computes and returns the itemized
   * breakdown for a caller-supplied amount without persisting anything. */
  preview: (id: string, subtotal: string) =>
    apiClient.post<TaxRatePreviewResult>(`/tax-rates/${id}/preview`, { subtotal }),
};
