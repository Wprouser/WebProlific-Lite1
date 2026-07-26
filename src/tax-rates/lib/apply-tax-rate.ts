import { Prisma } from '@prisma/client';
import { TaxRate } from '../domain/tax-rate.entity';

export interface TaxComponentBreakdown {
  componentName: string;
  componentRate: string;
  componentAmount: string;
}

export interface ApplyTaxRateResult {
  lineTaxAmount: string;
  lineTotal: string;
  components: TaxComponentBreakdown[];
}

/**
 * Core "how much tax does this line owe" calculation, factored out so
 * FR-04's real PO/GRN line creation can call the exact same logic later
 * (persisting the result into POLineTaxComponent/GRNLineTaxComponent)
 * instead of re-deriving it — this is also what backs the Tax
 * Configuration screen's "Preview" action, since no real PO/GRN line
 * exists yet to demonstrate against.
 *
 * Matches the spec's per-line formula: lineTaxAmount = round(lineSubtotal
 * * ratePercent / 100, 2). For a compound rate, each component is computed
 * independently the same way, and lineTaxAmount is defined as *their sum*
 * (not a separate ratePercent-based calculation) — this guarantees
 * components always sum to exactly lineTaxAmount, per
 * TaxRateComponent/POLineTaxComponent's own schema comments, with no
 * possible rounding drift between the two.
 */
export function applyTaxRate(subtotal: string, taxRate: TaxRate | null): ApplyTaxRateResult {
  const subtotalDecimal = new Prisma.Decimal(subtotal);

  if (!taxRate) {
    return { lineTaxAmount: '0.00', lineTotal: subtotalDecimal.toFixed(2), components: [] };
  }

  if (taxRate.isCompound && taxRate.components.length > 0) {
    const components: TaxComponentBreakdown[] = taxRate.components.map((component) => ({
      componentName: component.componentName,
      componentRate: component.componentRate,
      componentAmount: subtotalDecimal
        .mul(new Prisma.Decimal(component.componentRate))
        .div(100)
        .toDecimalPlaces(2)
        .toFixed(2),
    }));
    const lineTaxAmount = components
      .reduce((sum, c) => sum.plus(new Prisma.Decimal(c.componentAmount)), new Prisma.Decimal(0))
      .toFixed(2);
    const lineTotal = subtotalDecimal.plus(new Prisma.Decimal(lineTaxAmount)).toFixed(2);
    return { lineTaxAmount, lineTotal, components };
  }

  const lineTaxAmount = subtotalDecimal
    .mul(new Prisma.Decimal(taxRate.ratePercent))
    .div(100)
    .toDecimalPlaces(2)
    .toFixed(2);
  const lineTotal = subtotalDecimal.plus(new Prisma.Decimal(lineTaxAmount)).toFixed(2);
  return { lineTaxAmount, lineTotal, components: [] };
}
