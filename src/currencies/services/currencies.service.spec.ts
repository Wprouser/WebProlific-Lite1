import { NotFoundException } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { CurrencyRepository } from '../repositories/currency.repository';

function fixtureCurrency(overrides: Partial<import('../domain/currency.entity').Currency> = {}) {
  return { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2, ...overrides };
}

describe('CurrenciesService', () => {
  function buildService(currency = fixtureCurrency()) {
    const currencyRepository: Partial<CurrencyRepository> = {
      findAll: jest.fn().mockResolvedValue([currency]),
      findByCode: jest.fn().mockResolvedValue(currency),
    };
    const service = new CurrenciesService(currencyRepository as CurrencyRepository);
    return { service, currencyRepository };
  }

  it('list returns every registered currency', async () => {
    const { service } = buildService();
    expect(await service.list()).toEqual([fixtureCurrency()]);
  });

  it('getOrThrow returns the currency when it exists', async () => {
    const { service } = buildService();
    expect(await service.getOrThrow('SAR')).toEqual(fixtureCurrency());
  });

  it('getOrThrow throws NotFoundException for an unknown code', async () => {
    const { service, currencyRepository } = buildService();
    (currencyRepository.findByCode as jest.Mock).mockResolvedValue(null);
    await expect(service.getOrThrow('XXX')).rejects.toThrow(NotFoundException);
  });
});
