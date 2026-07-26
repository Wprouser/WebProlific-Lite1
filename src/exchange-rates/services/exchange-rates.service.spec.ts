import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRateRepository } from '../repositories/exchange-rate.repository';
import { CurrenciesService } from '../../currencies/services/currencies.service';

function fixtureRate(overrides: Partial<import('../domain/exchange-rate.entity').ExchangeRate> = {}) {
  return {
    id: 'r1',
    baseCurrency: 'SAR',
    targetCurrency: 'USD',
    rate: '3.750000',
    effectiveDate: new Date(),
    source: 'MANUAL' as const,
    ...overrides,
  };
}

describe('ExchangeRatesService', () => {
  function buildService() {
    const exchangeRateRepository: Partial<ExchangeRateRepository> = {
      create: jest.fn().mockResolvedValue(fixtureRate()),
      findLatestPerPair: jest.fn().mockResolvedValue([fixtureRate()]),
    };
    const currenciesService: Partial<CurrenciesService> = {
      getOrThrow: jest.fn().mockResolvedValue({ code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 }),
    };
    const service = new ExchangeRatesService(
      exchangeRateRepository as ExchangeRateRepository,
      currenciesService as CurrenciesService,
    );
    return { service, exchangeRateRepository, currenciesService };
  }

  describe('list', () => {
    it('passes base/target query filters through to the repository', async () => {
      const { service, exchangeRateRepository } = buildService();
      await service.list({ base: 'SAR', target: 'USD' });
      expect(exchangeRateRepository.findLatestPerPair).toHaveBeenCalledWith({
        baseCurrency: 'SAR',
        targetCurrency: 'USD',
      });
    });

    it('AC: omitting target still returns the latest-per-target list for that base', async () => {
      const { service, exchangeRateRepository } = buildService();
      await service.list({ base: 'SAR' });
      expect(exchangeRateRepository.findLatestPerPair).toHaveBeenCalledWith({
        baseCurrency: 'SAR',
        targetCurrency: undefined,
      });
    });
  });

  describe('create', () => {
    const dto = { baseCurrency: 'SAR', targetCurrency: 'USD', rate: '3.750000' };

    it('creates a new (always MANUAL) rate row after validating both currencies exist', async () => {
      const { service, exchangeRateRepository, currenciesService } = buildService();
      await service.create(dto);
      expect(currenciesService.getOrThrow).toHaveBeenCalledWith('SAR');
      expect(currenciesService.getOrThrow).toHaveBeenCalledWith('USD');
      expect(exchangeRateRepository.create).toHaveBeenCalledWith({
        baseCurrency: 'SAR',
        targetCurrency: 'USD',
        rate: '3.750000',
        source: 'MANUAL',
      });
    });

    it('AC: rejects a pair where base and target are the same currency', async () => {
      const { service } = buildService();
      await expect(service.create({ ...dto, targetCurrency: 'SAR' })).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown currency code', async () => {
      const { service, currenciesService } = buildService();
      (currenciesService.getOrThrow as jest.Mock).mockRejectedValue(new NotFoundException('Currency XXX not found'));
      await expect(service.create({ ...dto, targetCurrency: 'XXX' })).rejects.toThrow(NotFoundException);
    });
  });
});
