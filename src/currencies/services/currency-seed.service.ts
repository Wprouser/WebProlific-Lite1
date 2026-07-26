import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CURRENCY_REPOSITORY } from '../repositories/tokens';
import { CurrencyRepository } from '../repositories/currency.repository';
import { Currency } from '../domain/currency.entity';

// FR-16: Currency is global/platform-wide reference data, seeded once for
// the whole system — unlike TaxRate, this is not re-seeded per outlet.
// All six are conventional 2-decimal-place currencies (no JPY/KWD-style
// 0- or 3-decimal cases in this starter set).
export const STARTER_CURRENCIES: Currency[] = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', decimalPlaces: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2 },
];

/**
 * Runs once at application boot. Create-if-missing per code (not an
 * upsert-overwrite) so this never clobbers a currency row after the fact —
 * it only ever fills in gaps, matching "seed a sensible starter set once,"
 * not "reset to defaults on every restart."
 */
@Injectable()
export class CurrencySeedService implements OnModuleInit {
  private readonly logger = new Logger(CurrencySeedService.name);

  constructor(@Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository) {}

  async onModuleInit(): Promise<void> {
    for (const currency of STARTER_CURRENCIES) {
      const existing = await this.currencyRepository.findByCode(currency.code);
      if (!existing) {
        await this.currencyRepository.create(currency);
        this.logger.log(`Seeded starter currency ${currency.code}`);
      }
    }
  }
}
