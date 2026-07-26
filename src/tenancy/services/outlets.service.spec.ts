import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutletsService } from './outlets.service';
import { OutletRepository } from '../repositories/outlet.repository';
import { PropertyRepository } from '../repositories/property.repository';
import { CurrenciesService } from '../../currencies/services/currencies.service';
import { StockTransactionRepository } from '../../stock-transactions/repositories/stock-transaction.repository';

function fixtureOutlet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    propertyId: 'p1',
    chainId: 'c1',
    name: 'Main Restaurant',
    type: 'RESTAURANT',
    baseCurrency: 'SAR',
    poApprovalThreshold: null,
    isActive: true,
    ...overrides,
  };
}

function fixtureCurrencies() {
  return [
    { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  ];
}

describe('OutletsService', () => {
  function buildService(outlet = fixtureOutlet()) {
    const outletRepository: Partial<OutletRepository> = {
      create: jest.fn().mockResolvedValue(outlet),
      findById: jest.fn().mockResolvedValue(outlet),
      update: jest.fn().mockResolvedValue({ ...outlet, baseCurrency: 'USD' }),
    };
    const propertyRepository: Partial<PropertyRepository> = {
      findById: jest.fn().mockResolvedValue({ id: 'p1', chainId: 'c1' }),
    };
    const eventEmitter = { emitAsync: jest.fn().mockResolvedValue(undefined) };
    const currenciesService: Partial<CurrenciesService> = {
      list: jest.fn().mockResolvedValue(fixtureCurrencies()),
      getOrThrow: jest.fn().mockImplementation((code: string) => {
        const found = fixtureCurrencies().find((c) => c.code === code);
        if (!found) throw new NotFoundException(`Currency ${code} not found`);
        return Promise.resolve(found);
      }),
    };
    const stockTransactionRepository: Partial<StockTransactionRepository> = {
      existsForOutlet: jest.fn().mockResolvedValue(false),
    };
    const service = new OutletsService(
      outletRepository as OutletRepository,
      propertyRepository as PropertyRepository,
      eventEmitter as unknown as EventEmitter2,
      currenciesService as CurrenciesService,
      stockTransactionRepository as StockTransactionRepository,
    );
    return { service, outletRepository, propertyRepository, currenciesService, stockTransactionRepository };
  }

  describe('create', () => {
    it('validates a provided baseCurrency against the real Currency registry', async () => {
      const { service, currenciesService } = buildService();
      await service.create('p1', { name: 'X', type: 'RESTAURANT', baseCurrency: 'SAR' });
      expect(currenciesService.getOrThrow).toHaveBeenCalledWith('SAR');
    });

    it('rejects an unknown baseCurrency', async () => {
      const { service } = buildService();
      await expect(
        service.create('p1', { name: 'X', type: 'RESTAURANT', baseCurrency: 'ZZZ' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not require a currency lookup when baseCurrency is omitted (schema default applies)', async () => {
      const { service, currenciesService } = buildService();
      await service.create('p1', { name: 'X', type: 'RESTAURANT' });
      expect(currenciesService.getOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('getCurrencySettings', () => {
    it('returns the outlet base currency plus every registered currency code', async () => {
      const { service } = buildService();
      const result = await service.getCurrencySettings('o1');
      expect(result).toEqual({ baseCurrency: 'SAR', supportedCurrencies: ['SAR', 'USD'] });
    });
  });

  describe('updateCurrencySettings', () => {
    it('AC: updates the base currency when the outlet has no transactional history', async () => {
      const { service, outletRepository } = buildService();
      const result = await service.updateCurrencySettings('o1', { baseCurrency: 'USD' });
      expect(outletRepository.update).toHaveBeenCalledWith('o1', { baseCurrency: 'USD' });
      expect(result.baseCurrency).toBe('USD');
    });

    it('AC: blocks the change with 409 once the outlet has any StockTransaction history', async () => {
      const { service, stockTransactionRepository, outletRepository } = buildService();
      (stockTransactionRepository.existsForOutlet as jest.Mock).mockResolvedValue(true);

      await expect(service.updateCurrencySettings('o1', { baseCurrency: 'USD' })).rejects.toThrow(
        ConflictException,
      );
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown target currency', async () => {
      const { service } = buildService();
      await expect(service.updateCurrencySettings('o1', { baseCurrency: 'ZZZ' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
