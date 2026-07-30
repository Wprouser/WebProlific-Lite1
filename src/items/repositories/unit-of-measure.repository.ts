import { UnitOfMeasure } from '../domain/unit-of-measure.entity';

export interface CreateUnitOfMeasureInput {
  outletId: string;
  name: string;
  abbreviation: string;
  baseUnitId?: string;
  conversionFactor?: string;
}

export interface UpdateUnitOfMeasureInput {
  name?: string;
  abbreviation?: string;
  isActive?: boolean;
  // Explicit null clears an existing conversion relationship (demotes a
  // derived unit back to a plain base unit) — both must always change
  // together, see UnitsService's validation.
  baseUnitId?: string | null;
  conversionFactor?: string | null;
}

export interface UnitOfMeasureFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  // Omitted entirely = both active and inactive rows, same convention as
  // TaxRateFilters — the Unit Management screen needs to show deactivated
  // units too, not just what's currently selectable on the Item form.
  isActive?: boolean;
}

export interface UnitOfMeasureRepository {
  create(data: CreateUnitOfMeasureInput): Promise<UnitOfMeasure>;
  findById(id: string): Promise<UnitOfMeasure | null>;
  findByNameAndOutlet(name: string, outletId: string): Promise<UnitOfMeasure | null>;
  update(id: string, data: UpdateUnitOfMeasureInput): Promise<UnitOfMeasure>;
  findScoped(filters: UnitOfMeasureFilters): Promise<UnitOfMeasure[]>;
  /** Units whose baseUnitId currently points to this one — used to guard the
   * flat-hierarchy rule when re-parenting a unit that's already in use as a
   * base (see UnitsService). */
  findByBaseUnitId(baseUnitId: string): Promise<UnitOfMeasure[]>;
}
