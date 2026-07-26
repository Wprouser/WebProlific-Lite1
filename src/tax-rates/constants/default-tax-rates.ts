// Seeded onto every newly created outlet (see DefaultTaxRatesListener),
// chosen by the outlet's base currency rather than one fixed set for every
// outlet regardless of location — same event mechanism as
// items/constants/default-categories.ts. None are isDefault: true — per
// FR-04/FR-16, tax stays an explicit per-line choice, never silently
// auto-applied.

export interface DefaultTaxRateComponentSeed {
  componentName: string;
  componentRate: string;
}

export interface DefaultTaxRateSeed {
  name: string;
  ratePercent: string;
  isCompound?: boolean;
  countryCode?: string;
  components?: DefaultTaxRateComponentSeed[];
}

const SAUDI_ARABIA_DEFAULTS: DefaultTaxRateSeed[] = [
  { name: 'VAT 15%', ratePercent: '15.00', countryCode: 'SA' },
  { name: 'Zero-Rated', ratePercent: '0.00', countryCode: 'SA' },
];

const UAE_DEFAULTS: DefaultTaxRateSeed[] = [{ name: 'VAT 5%', ratePercent: '5.00', countryCode: 'AE' }];

// India's GST doesn't have one flat rate — it's charged as a compound
// split (CGST+SGST for intra-state, or a single IGST for inter-state), and
// this system doesn't attempt automatic state detection (see spec) — both
// variants are seeded as separate selectable rates per slab, and the
// person creating a PO/GRN line picks whichever applies.
const INDIA_GST_SLABS = ['5.00', '12.00', '18.00', '28.00'];

function indiaGstDefaults(): DefaultTaxRateSeed[] {
  return INDIA_GST_SLABS.flatMap((slab): DefaultTaxRateSeed[] => {
    const half = (Number(slab) / 2).toFixed(2);
    const label = slab.replace(/\.00$/, '');
    return [
      {
        name: `GST ${label}% (Intra-state)`,
        ratePercent: slab,
        isCompound: true,
        countryCode: 'IN',
        components: [
          { componentName: 'CGST', componentRate: half },
          { componentName: 'SGST', componentRate: half },
        ],
      },
      {
        name: `GST ${label}% (Inter-state)`,
        ratePercent: slab,
        isCompound: true,
        countryCode: 'IN',
        components: [{ componentName: 'IGST', componentRate: slab }],
      },
    ];
  });
}

// A lookup table, not a hardcoded single default — extensible the same way
// the Currency/Language registries are (adding a new country's standard
// rates later is a data addition here, not a code change elsewhere).
const CURRENCY_TO_DEFAULT_TAX_RATES: Record<string, () => DefaultTaxRateSeed[]> = {
  SAR: () => SAUDI_ARABIA_DEFAULTS,
  AED: () => UAE_DEFAULTS,
  INR: () => indiaGstDefaults(),
};

export function getDefaultTaxRatesForCurrency(currencyCode: string): DefaultTaxRateSeed[] {
  return (CURRENCY_TO_DEFAULT_TAX_RATES[currencyCode] ?? (() => SAUDI_ARABIA_DEFAULTS))();
}
