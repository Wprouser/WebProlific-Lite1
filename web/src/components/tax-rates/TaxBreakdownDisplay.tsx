import { useTranslation } from 'react-i18next';

export interface TaxBreakdownDisplayProps {
  lineTaxAmount: string;
  components: { componentName: string; componentRate: string; componentAmount: string }[];
  /** Optional — prefixes each amount (e.g. "SAR"). Omitted when there's no
   * real currency context yet (e.g. the Tax Configuration screen's
   * preview, ahead of FR-04 actually carrying a currencyCode). */
  currencyCode?: string;
}

/**
 * Renders a PO/GRN line's tax exactly the way the spec requires: a single
 * line for a simple rate, or one itemized line per component for a
 * compound rate (e.g. "CGST 9%: SAR 18.00" / "SGST 9%: SAR 18.00") — never
 * a single lumped figure once the rate is compound. Built once here so
 * FR-04's real PO/GRN line/document display reuses it verbatim instead of
 * re-deriving the same formatting.
 */
export function TaxBreakdownDisplay({ lineTaxAmount, components, currencyCode }: TaxBreakdownDisplayProps) {
  const { t } = useTranslation();
  const prefix = currencyCode ? `${currencyCode} ` : '';

  if (components.length === 0) {
    return <p className="text-sm text-foreground">{t('taxRates.breakdown.tax', { amount: `${prefix}${lineTaxAmount}` })}</p>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {components.map((component) => (
        <p key={component.componentName} className="text-sm text-foreground">
          {component.componentName} {component.componentRate}%: {prefix}
          {component.componentAmount}
        </p>
      ))}
    </div>
  );
}
