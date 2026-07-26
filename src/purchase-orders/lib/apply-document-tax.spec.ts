import { applyDocumentLineTax, convertToBaseCurrency, sumDocumentTotals } from './apply-document-tax';
import { TaxRate } from '../../tax-rates/domain/tax-rate.entity';

function fixtureSimpleTaxRate(ratePercent: string): TaxRate {
  return {
    id: 't1',
    outletId: 'o1',
    name: 'VAT 15%',
    ratePercent,
    isCompound: false,
    isDefault: false,
    isActive: true,
    countryCode: 'SA',
    createdAt: new Date(),
    updatedAt: new Date(),
    components: [],
  };
}

function fixtureCompoundTaxRate(): TaxRate {
  return {
    id: 't2',
    outletId: 'o1',
    name: 'GST 18% (Intra-state)',
    ratePercent: '18.00',
    isCompound: true,
    isDefault: false,
    isActive: true,
    countryCode: 'IN',
    createdAt: new Date(),
    updatedAt: new Date(),
    components: [
      { id: 'c1', taxRateId: 't2', componentName: 'CGST', componentRate: '9.00', sortOrder: 0 },
      { id: 'c2', taxRateId: 't2', componentName: 'SGST', componentRate: '9.00', sortOrder: 1 },
    ],
  };
}

describe('applyDocumentLineTax', () => {
  describe('exclusive mode (default)', () => {
    it('AC: computes lineSubtotal = qty * price, tax added on top for a simple rate', () => {
      const result = applyDocumentLineTax('20', '87.00', fixtureSimpleTaxRate('15.00'), false);
      expect(result.lineSubtotal).toBe('1740.00');
      expect(result.lineTaxAmount).toBe('261.00');
      expect(result.lineTotal).toBe('2001.00');
      expect(result.components).toEqual([]);
    });

    it('AC: a compound rate produces an itemized component breakdown summing to lineTaxAmount', () => {
      const result = applyDocumentLineTax('10', '200.00', fixtureCompoundTaxRate(), false);
      expect(result.lineSubtotal).toBe('2000.00');
      expect(result.components).toEqual([
        { componentName: 'CGST', componentRate: '9.00', componentAmount: '180.00' },
        { componentName: 'SGST', componentRate: '9.00', componentAmount: '180.00' },
      ]);
      expect(result.lineTaxAmount).toBe('360.00');
      expect(result.lineTotal).toBe('2360.00');
    });

    it('AC: no taxRateId (null) produces a valid untaxed line, never an error', () => {
      const result = applyDocumentLineTax('5', '92.00', null, false);
      expect(result.lineSubtotal).toBe('460.00');
      expect(result.lineTaxAmount).toBe('0.00');
      expect(result.lineTotal).toBe('460.00');
      expect(result.components).toEqual([]);
    });
  });

  describe('inclusive mode', () => {
    it('AC: reverse-calculates lineSubtotal/lineTaxAmount from the entered (inclusive) price for a simple rate', () => {
      // qty=1, price=118 inclusive of 18% -> lineTotal=118, lineSubtotal=100.00, tax=18.00.
      const result = applyDocumentLineTax('1', '118.00', fixtureSimpleTaxRate('18.00'), true);
      expect(result.lineTotal).toBe('118.00');
      expect(result.lineSubtotal).toBe('100.00');
      expect(result.lineTaxAmount).toBe('18.00');
    });

    it('AC: lineTaxAmount is always exactly lineTotal - lineSubtotal, even on unclean numbers', () => {
      const result = applyDocumentLineTax('1', '100.00', fixtureSimpleTaxRate('18.00'), true);
      const subtotal = Number(result.lineSubtotal);
      const tax = Number(result.lineTaxAmount);
      const total = Number(result.lineTotal);
      expect(Math.round((subtotal + tax) * 100) / 100).toBe(total);
    });

    it('AC: a compound rate in inclusive mode still produces components that sum exactly to lineTaxAmount', () => {
      const result = applyDocumentLineTax('1', '118.00', fixtureCompoundTaxRate(), true);
      expect(result.lineTotal).toBe('118.00');
      expect(result.lineSubtotal).toBe('100.00');
      expect(result.lineTaxAmount).toBe('18.00');
      expect(result.components).toEqual([
        { componentName: 'CGST', componentRate: '9.00', componentAmount: '9.00' },
        { componentName: 'SGST', componentRate: '9.00', componentAmount: '9.00' },
      ]);
      const componentSum = result.components.reduce((sum, c) => sum + Number(c.componentAmount), 0);
      expect(componentSum.toFixed(2)).toBe(result.lineTaxAmount);
    });

    it('components sum exactly to lineTaxAmount even when the split does not divide evenly', () => {
      // 3-way compound split against an unclean amount, to exercise the
      // last-component-absorbs-the-remainder logic.
      const threeWayRate: TaxRate = {
        ...fixtureCompoundTaxRate(),
        ratePercent: '18.00',
        components: [
          { id: 'c1', taxRateId: 't3', componentName: 'A', componentRate: '6.00', sortOrder: 0 },
          { id: 'c2', taxRateId: 't3', componentName: 'B', componentRate: '6.00', sortOrder: 1 },
          { id: 'c3', taxRateId: 't3', componentName: 'C', componentRate: '6.00', sortOrder: 2 },
        ],
      };
      const result = applyDocumentLineTax('1', '100.00', threeWayRate, true);
      const componentSum = result.components.reduce((sum, c) => sum + Number(c.componentAmount), 0);
      expect(componentSum.toFixed(2)).toBe(result.lineTaxAmount);
    });

    it('no taxRateId (null) is untaxed even in inclusive mode — the whole amount is the subtotal', () => {
      const result = applyDocumentLineTax('2', '50.00', null, true);
      expect(result.lineSubtotal).toBe('100.00');
      expect(result.lineTaxAmount).toBe('0.00');
      expect(result.lineTotal).toBe('100.00');
    });
  });
});

describe('sumDocumentTotals', () => {
  it('AC: sums lineSubtotal/lineTaxAmount across lines, adding Other Charges into totalValue', () => {
    const lines = [
      { lineSubtotal: '1740.00', lineTaxAmount: '261.00' },
      { lineSubtotal: '460.00', lineTaxAmount: '0.00' },
    ];
    const result = sumDocumentTotals(lines, '0.00', '25.00');
    expect(result.subtotal).toBe('2200.00');
    expect(result.taxAmount).toBe('261.00');
    expect(result.totalValue).toBe('2486.00');
  });

  it('AC: a Discount amount reduces totalValue', () => {
    const result = sumDocumentTotals([{ lineSubtotal: '100.00', lineTaxAmount: '15.00' }], '10.00', '0.00');
    expect(result.totalValue).toBe('105.00');
  });

  it('applies both Discount and Other Charges together', () => {
    const result = sumDocumentTotals([{ lineSubtotal: '100.00', lineTaxAmount: '15.00' }], '10.00', '5.00');
    expect(result.totalValue).toBe('110.00');
  });

  it('defaults totalValue to subtotal + tax when both are zero', () => {
    const result = sumDocumentTotals([{ lineSubtotal: '100.00', lineTaxAmount: '15.00' }], '0.00', '0.00');
    expect(result.totalValue).toBe('115.00');
  });

  it('an empty line list sums to zero', () => {
    const result = sumDocumentTotals([], '0.00', '0.00');
    expect(result).toEqual({ subtotal: '0.00', taxAmount: '0.00', totalValue: '0.00' });
  });
});

describe('convertToBaseCurrency', () => {
  it('multiplies the amount by the exchange rate, rounded to 2 decimal places', () => {
    expect(convertToBaseCurrency('100.00', '3.75')).toBe('375.00');
  });

  it('an exchangeRateToBase of 1 (same currency) leaves the amount unchanged', () => {
    expect(convertToBaseCurrency('2486.00', '1')).toBe('2486.00');
  });
});
