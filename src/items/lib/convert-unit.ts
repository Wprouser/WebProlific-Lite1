import { Prisma } from '@prisma/client';
import { UnitOfMeasure } from '../domain/unit-of-measure.entity';

/**
 * FR-01's unit conversion — internal utility only for now (no REST endpoint
 * until FR-05's Recipe/BOM actually consumes it). Only the two fields this
 * needs from a UnitOfMeasure row, so callers (and tests) don't have to
 * build a full fixture.
 */
export type ConvertibleUnit = Pick<UnitOfMeasure, 'id' | 'baseUnitId' | 'conversionFactor'>;

function resolvedBaseId(unit: ConvertibleUnit): string {
  return unit.baseUnitId ?? unit.id;
}

/**
 * Converts `quantity` from `fromUnit` to `toUnit`. Only possible when both
 * units resolve to the same base (one of them may *be* the shared base) —
 * see FR-01 spec's "Conversion business rules." Throws rather than
 * producing a silently-wrong number for units from unrelated families
 * (e.g. Kilogram and Litre).
 */
export function convertUnitQuantity(quantity: string, fromUnit: ConvertibleUnit, toUnit: ConvertibleUnit): string {
  if (resolvedBaseId(fromUnit) !== resolvedBaseId(toUnit)) {
    throw new Error(
      `Cannot convert between unit ${fromUnit.id} and ${toUnit.id} — they do not share a common base unit`,
    );
  }

  const quantityInBase = new Prisma.Decimal(quantity).times(
    new Prisma.Decimal(fromUnit.conversionFactor ?? '1'),
  );
  const quantityInTarget = quantityInBase.dividedBy(new Prisma.Decimal(toUnit.conversionFactor ?? '1'));

  return quantityInTarget.toFixed(3);
}
