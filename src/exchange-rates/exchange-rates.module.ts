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
})
export class ExchangeRatesModule {}
