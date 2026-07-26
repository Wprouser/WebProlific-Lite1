import type { ApiTaxRate } from './tax-rates-api';

export interface LineTaxPreview {
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  components: { componentName: string; componentRate: string; componentAmount: string }[];
}

/**
 * Client-side-only preview of FR-04's per-line tax calculation — mirrors
 * src/purchase-orders/lib/apply-document-tax.ts approximately, using plain
 * JS numbers rounded to 2dp, purely so the PO/GRN form can show live
 * running totals as the user edits. The server always recomputes
 * authoritatively from scratch on save; this never needs to be exact to
 * the last cent, just close enough for an in-progress form to be useful.
 */
export function previewLineTax(
  quantity: string,
  price: string,
  taxRate: ApiTaxRate | null,
  isTaxInclusive: boolean,
): LineTaxPreview {
  const qty = Number(quantity) || 0;
  const priceNum = Number(price) || 0;
  const amountAsEntered = round2(qty * priceNum);

  if (!isTaxInclusive || !taxRate) {
    const lineSubtotal = amountAsEntered;
    const { lineTaxAmount, components } = applyForward(lineSubtotal, taxRate);
    return {
      lineSubtotal: lineSubtotal.toFixed(2),
      lineTaxAmount: lineTaxAmount.toFixed(2),
      lineTotal: (lineSubtotal + lineTaxAmount).toFixed(2),
      components,
    };
  }

  const lineTotal = amountAsEntered;
  const ratePercent = Number(taxRate.ratePercent) || 0;
  const lineSubtotal = ratePercent === 0 ? lineTotal : round2(lineTotal / (1 + ratePercent / 100));
  const lineTaxAmount = round2(lineTotal - lineSubtotal);
  const components = apportion(taxRate, lineTaxAmount);

  return { lineSubtotal: lineSubtotal.toFixed(2), lineTaxAmount: lineTaxAmount.toFixed(2), lineTotal: lineTotal.toFixed(2), components };
}

export interface DocumentTotalsPreview {
  subtotal: string;
  taxAmount: string;
  totalValue: string;
}

export function previewDocumentTotals(
  lines: { lineSubtotal: string; lineTaxAmount: string }[],
  discountAmount: string,
  otherChargesAmount: string,
): DocumentTotalsPreview {
  const subtotal = lines.reduce((sum, l) => sum + (Number(l.lineSubtotal) || 0), 0);
  const taxAmount = lines.reduce((sum, l) => sum + (Number(l.lineTaxAmount) || 0), 0);
  const totalValue = subtotal + taxAmount - (Number(discountAmount) || 0) + (Number(otherChargesAmount) || 0);
  return { subtotal: round2(subtotal).toFixed(2), taxAmount: round2(taxAmount).toFixed(2), totalValue: round2(totalValue).toFixed(2) };
}

function applyForward(lineSubtotal: number, taxRate: ApiTaxRate | null) {
  if (!taxRate) return { lineTaxAmount: 0, components: [] as LineTaxPreview['components'] };
  if (taxRate.isCompound && taxRate.components.length > 0) {
    const components = taxRate.components.map((c) => ({
      componentName: c.componentName,
      componentRate: c.componentRate,
      componentAmount: round2((lineSubtotal * Number(c.componentRate)) / 100).toFixed(2),
    }));
    const lineTaxAmount = components.reduce((sum, c) => sum + Number(c.componentAmount), 0);
    return { lineTaxAmount, components };
  }
  return { lineTaxAmount: round2((lineSubtotal * Number(taxRate.ratePercent)) / 100), components: [] };
}

function apportion(taxRate: ApiTaxRate, lineTaxAmount: number): LineTaxPreview['components'] {
  if (!taxRate.isCompound || taxRate.components.length === 0) return [];
  const totalRate = Number(taxRate.ratePercent) || 0;
  let allocated = 0;
  return taxRate.components.map((c, index) => {
    const isLast = index === taxRate.components.length - 1;
    const amount = isLast
      ? round2(lineTaxAmount - allocated)
      : totalRate === 0
        ? 0
        : round2((lineTaxAmount * Number(c.componentRate)) / totalRate);
    allocated = round2(allocated + amount);
    return { componentName: c.componentName, componentRate: c.componentRate, componentAmount: amount.toFixed(2) };
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
