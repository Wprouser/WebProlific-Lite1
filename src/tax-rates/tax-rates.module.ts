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
  // FR-04: PurchaseOrdersModule/GrnModule need this to validate/snapshot a
  // line's taxRateId without going through TaxRatesService's own
  // request-gated access check (the PO/GRN's own outlet check already
  // covers authorization; this is just a data lookup).
  exports: [TAX_RATE_REPOSITORY],
})
export class TaxRatesModule {}
