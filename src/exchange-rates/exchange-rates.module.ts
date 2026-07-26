import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ExchangeRatesController } from './controllers/exchange-rates.controller';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { EXCHANGE_RATE_REPOSITORY } from './repositories/tokens';
import { PrismaExchangeRateRepository } from './repositories/prisma/prisma-exchange-rate.repository';

@Module({
  imports: [RbacModule, CurrenciesModule],
  controllers: [ExchangeRatesController],
  providers: [
    ExchangeRatesService,
    { provide: EXCHANGE_RATE_REPOSITORY, useClass: PrismaExchangeRateRepository },
  ],
  // FR-04: PurchaseOrdersModule needs this to auto-derive a PO's
  // exchangeRateToBase default from the latest on-file rate.
  exports: [EXCHANGE_RATE_REPOSITORY],
})
export class ExchangeRatesModule {}
