import { DefaultTaxRatesListener } from './default-tax-rates.listener';
import { TaxRateRepository } from '../repositories/tax-rate.repository';
import { getDefaultTaxRatesForCurrency } from '../constants/default-tax-rates';

describe('DefaultTaxRatesListener', () => {
  function buildListener() {
    const create = jest.fn().mockResolvedValue({});
    const taxRateRepository: Partial<TaxRateRepository> = { create };
    const listener = new DefaultTaxRatesListener(taxRateRepository as TaxRateRepository);
    return { listener, create };
  }

  it('AC: seeds Saudi VAT defaults for a SAR-currency outlet, none marked isDefault', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o1', baseCurrency: 'SAR' });

    const expected = getDefaultTaxRatesForCurrency('SAR');
    expect(create).toHaveBeenCalledTimes(expected.length);
    for (const rate of expected) {
      expect(create).toHaveBeenCalledWith({ ...rate, outletId: 'o1' });
    }
    expect(create.mock.calls.every(([input]) => !('isDefault' in input))).toBe(true);
  });

  it('AC: seeds UAE VAT 5% for an AED-currency outlet', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o2', baseCurrency: 'AED' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'VAT 5%', ratePercent: '5.00', countryCode: 'AE', outletId: 'o2' }),
    );
  });

  it('AC: seeds India GST slabs with Intra-state (CGST+SGST) and Inter-state (IGST) variants for an INR-currency outlet, not Saudi VAT', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o3', baseCurrency: 'INR' });

    const names = create.mock.calls.map(([input]) => input.name);
    expect(names).toEqual([
      'GST 5% (Intra-state)',
      'GST 5% (Inter-state)',
      'GST 12% (Intra-state)',
      'GST 12% (Inter-state)',
      'GST 18% (Intra-state)',
      'GST 18% (Inter-state)',
      'GST 28% (Intra-state)',
      'GST 28% (Inter-state)',
    ]);
    expect(names).not.toContain('VAT 15%');

    const intra18 = create.mock.calls.find(([input]) => input.name === 'GST 18% (Intra-state)')![0];
    expect(intra18.isCompound).toBe(true);
    expect(intra18.components).toEqual([
      { componentName: 'CGST', componentRate: '9.00' },
      { componentName: 'SGST', componentRate: '9.00' },
    ]);

    const inter18 = create.mock.calls.find(([input]) => input.name === 'GST 18% (Inter-state)')![0];
    expect(inter18.components).toEqual([{ componentName: 'IGST', componentRate: '18.00' }]);
  });

  it('falls back to Saudi defaults for an unrecognized currency', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o4', baseCurrency: 'USD' });

    const names = create.mock.calls.map(([input]) => input.name);
    expect(names).toEqual(['VAT 15%', 'Zero-Rated']);
  });
});
