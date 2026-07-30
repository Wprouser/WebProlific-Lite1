export interface UnitOfMeasure {
  id: string;
  outletId: string;
  name: string;
  abbreviation: string;
  // null = this unit IS a base unit. Non-null = converts to that base unit
  // at conversionFactor — see UnitsService for the flat-hierarchy rule this
  // must satisfy (baseUnitId can never point to another derived unit).
  baseUnitId: string | null;
  conversionFactor: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
