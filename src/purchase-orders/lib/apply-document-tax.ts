import { Prisma } from '@prisma/client';
import { TaxRate } from '../../tax-rates/domain/tax-rate.entity';
import { applyTaxRate, TaxComponentBreakdown } from '../../tax-rates/lib/apply-tax-rate';

export interface DocumentLineTaxResult {
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  components: TaxComponentBreakdown[];
}

/**
 * FR-04's per-line calculation, shared by PurchaseOrder and GRN (both
 * documents use the identical rule) — builds on FR-16's `applyTaxRate` for
 * the compound-tax itemized breakdown rather than re-deriving it.
 *
 * `price` is the unit price *as entered*, whose meaning depends on
 * `isTaxInclusive`:
 *   - Exclusive (default): price excludes tax — `lineSubtotal = qty * price`,
 *     tax is added on top via `applyTaxRate`.
 *   - Inclusive: price already includes tax — `lineTotal = qty * price` (the
 *     amount as entered, per spec), and `lineSubtotal`/`lineTaxAmount` are
 *     reverse-calculated from it: `lineSubtotal = lineTotal / (1 +
 *     ratePercent/100)`, `lineTaxAmount = lineTotal - lineSubtotal` — an
 *     exact subtraction of two already-rounded amounts, per the spec's own
 *     formula, rather than recomputing tax forward from the rounded
 *     subtotal (which can drift by a cent against that formula on unclean
 *     numbers). Compound components are then apportioned from that
 *     already-fixed lineTaxAmount by each component's share of the overall
 *     rate, with the last component absorbing any rounding remainder so
 *     they always sum to exactly lineTaxAmount — never a separate
 *     forward-computed total.
 */
export function applyDocumentLineTax(
  quantity: string,
  price: string,
  taxRate: TaxRate | null,
  isTaxInclusive: boolean,
): DocumentLineTaxResult {
  const lineAmountAsEntered = new Prisma.Decimal(quantity).mul(new Prisma.Decimal(price)).toDecimalPlaces(2);

  if (!isTaxInclusive || !taxRate) {
    const lineSubtotal = lineAmountAsEntered.toFixed(2);
    const { lineTaxAmount, lineTotal, components } = applyTaxRate(lineSubtotal, taxRate);
    return { lineSubtotal, lineTaxAmount, lineTotal, components };
  }

  const lineTotal = lineAmountAsEntered;
  const rate = new Prisma.Decimal(taxRate.ratePercent);
  const lineSubtotal = rate.equals(0) ? lineTotal : lineTotal.div(rate.div(100).plus(1)).toDecimalPlaces(2);
  const lineTaxAmount = lineTotal.minus(lineSubtotal);

  const components = apportionComponents(taxRate, lineTaxAmount);

  return {
    lineSubtotal: lineSubtotal.toFixed(2),
    lineTaxAmount: lineTaxAmount.toFixed(2),
    lineTotal: lineTotal.toFixed(2),
    components,
  };
}

/** Splits an already-fixed lineTaxAmount across a compound rate's
 * components by each one's share of the overall rate, giving the last
 * component whatever remains so the sum is always exact — never
 * independently recomputed per component (that's the exclusive-mode
 * behavior in applyTaxRate; here the total is fixed first). */
function apportionComponents(taxRate: TaxRate, lineTaxAmount: Prisma.Decimal): TaxComponentBreakdown[] {
  if (!taxRate.isCompound || taxRate.components.length === 0) return [];

  const totalRate = new Prisma.Decimal(taxRate.ratePercent);
  const components: TaxComponentBreakdown[] = [];
  let allocated = new Prisma.Decimal(0);

  taxRate.components.forEach((component, index) => {
    const isLast = index === taxRate.components.length - 1;
    const componentRate = new Prisma.Decimal(component.componentRate);
    const amount = isLast
      ? lineTaxAmount.minus(allocated)
      : totalRate.equals(0)
        ? new Prisma.Decimal(0)
        : lineTaxAmount.mul(componentRate).div(totalRate).toDecimalPlaces(2);
    allocated = allocated.plus(amount);
    components.push({
      componentName: component.componentName,
      componentRate: component.componentRate,
      componentAmount: amount.toFixed(2),
    });
  });

  return components;
}

export interface DocumentTotals {
  subtotal: string;
  taxAmount: string;
  totalValue: string;
}

/** Aggregates already-computed lines (plus the document-level Discount and
 * Other Charges amounts) into the PO/GRN header totals — `totalValue =
 * subtotal + taxAmount - discountAmount + otherChargesAmount`, in the
 * document's own currencyCode. Discount reduces the total; Other Charges
 * (rounding, freight, misc.) adds to it — both optional, both default to
 * 0.00. */
export function sumDocumentTotals(
  lines: { lineSubtotal: string; lineTaxAmount: string }[],
  discountAmount: string,
  otherChargesAmount: string,
): DocumentTotals {
  const subtotal = lines.reduce((sum, l) => sum.plus(new Prisma.Decimal(l.lineSubtotal)), new Prisma.Decimal(0));
  const taxAmount = lines.reduce((sum, l) => sum.plus(new Prisma.Decimal(l.lineTaxAmount)), new Prisma.Decimal(0));
  const totalValue = subtotal
    .plus(taxAmount)
    .minus(new Prisma.Decimal(discountAmount))
    .plus(new Prisma.Decimal(otherChargesAmount));
  return { subtotal: subtotal.toFixed(2), taxAmount: taxAmount.toFixed(2), totalValue: totalValue.toFixed(2) };
}

/** Converts a document-currency amount to the outlet's base currency using
 * the document's own snapshotted exchangeRateToBase — used for the
 * approval-threshold comparison (spec: "always converts totalValue to the
 * outlet's base currency ... so thresholds stay consistent regardless of
 * which currency a supplier bills in") and for SupplierPriceHistory's
 * base-currency equivalent. */
export function convertToBaseCurrency(amount: string, exchangeRateToBase: string): string {
  return new Prisma.Decimal(amount).mul(new Prisma.Decimal(exchangeRateToBase)).toDecimalPlaces(2).toFixed(2);
}
