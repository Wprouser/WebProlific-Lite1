import { TaxRate } from '../domain/tax-rate.entity';

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
  /** Only meaningful when isCompound is true — see TaxRatesService for the
   * sum-validation this repository itself does not enforce. */
  components?: TaxRateComponentInput[];
}

export interface UpdateTaxRateInput {
  name?: string;
  ratePercent?: string;
  isCompound?: boolean;
  isActive?: boolean;
  /** When provided, replaces the tax rate's entire component set (delete +
   * recreate) — matches the spec's "editing only affects future lines"
   * rule, since nothing else references these rows yet. */
  components?: TaxRateComponentInput[];
}

export interface TaxRateFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  // Omitted entirely = return both active and inactive rows (matches
  // ItemFilters' isActive convention) — the Tax Configuration screen needs
  // to see everything; only callers building a "pick one for a new
  // selection" dropdown pass isActive: true explicitly.
  isActive?: boolean;
}

export interface TaxRateRepository {
  create(data: CreateTaxRateInput): Promise<TaxRate>;
  findById(id: string): Promise<TaxRate | null>;
  update(id: string, data: UpdateTaxRateInput): Promise<TaxRate>;
  findScoped(filters: TaxRateFilters): Promise<TaxRate[]>;
}
