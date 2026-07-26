import { CurrencySeedService, STARTER_CURRENCIES } from './currency-seed.service';
import { CurrencyRepository } from '../repositories/currency.repository';

describe('CurrencySeedService', () => {
  it('AC: seeds every starter currency on boot when none exist yet', async () => {
    const currencyRepository: Partial<CurrencyRepository> = {
      findByCode: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(STARTER_CURRENCIES[0]),
    };
    const service = new CurrencySeedService(currencyRepository as CurrencyRepository);
    await service.onModuleInit();

    expect(currencyRepository.create).toHaveBeenCalledTimes(STARTER_CURRENCIES.length);
    for (const currency of STARTER_CURRENCIES) {
      expect(currencyRepository.create).toHaveBeenCalledWith(currency);
    }
  });

  it('AC: never overwrites a currency that already exists (create-if-missing, not upsert)', async () => {
    const currencyRepository: Partial<CurrencyRepository> = {
      findByCode: jest.fn().mockResolvedValue({ code: 'SAR', name: 'Custom Name', symbol: 'SAR', decimalPlaces: 2 }),
      create: jest.fn(),
    };
    const service = new CurrencySeedService(currencyRepository as CurrencyRepository);
    await service.onModuleInit();

    expect(currencyRepository.create).not.toHaveBeenCalled();
  });

  it('seeds only the missing currencies when some already exist', async () => {
    const currencyRepository: Partial<CurrencyRepository> = {
      findByCode: jest.fn().mockImplementation((code: string) =>
        Promise.resolve(code === 'SAR' ? STARTER_CURRENCIES[0] : null),
      ),
      create: jest.fn().mockResolvedValue(STARTER_CURRENCIES[1]),
    };
    const service = new CurrencySeedService(currencyRepository as CurrencyRepository);
    await service.onModuleInit();

    expect(currencyRepository.create).toHaveBeenCalledTimes(STARTER_CURRENCIES.length - 1);
    expect(currencyRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'SAR' }));
  });
});
