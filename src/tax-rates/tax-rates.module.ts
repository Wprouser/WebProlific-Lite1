import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { TaxRatesController } from './controllers/tax-rates.controller';
import { TaxRatesService } from './services/tax-rates.service';
import { DefaultTaxRatesListener } from './listeners/default-tax-rates.listener';
import { TAX_RATE_REPOSITORY } from './repositories/tokens';
import { PrismaTaxRateRepository } from './repositories/prisma/prisma-tax-rate.repository';

@Module({
  imports: [RbacModule],
  controllers: [TaxRatesController],
  providers: [
    TaxRatesService,
    DefaultTaxRatesListener,
    { provide: TAX_RATE_REPOSITORY, useClass: PrismaTaxRateRepository },
  ],
})
export class TaxRatesModule {}
