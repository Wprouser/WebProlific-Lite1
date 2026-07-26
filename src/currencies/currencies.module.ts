import { Module } from '@nestjs/common';
import { CurrenciesController } from './controllers/currencies.controller';
import { CurrenciesService } from './services/currencies.service';
import { CurrencySeedService } from './services/currency-seed.service';
import { CURRENCY_REPOSITORY } from './repositories/tokens';
import { PrismaCurrencyRepository } from './repositories/prisma/prisma-currency.repository';

@Module({
  controllers: [CurrenciesController],
  providers: [
    CurrenciesService,
    CurrencySeedService,
    { provide: CURRENCY_REPOSITORY, useClass: PrismaCurrencyRepository },
  ],
  // TenancyModule needs CurrenciesService to validate an outlet's
  // baseCurrency against the real registry (see OutletsService).
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
