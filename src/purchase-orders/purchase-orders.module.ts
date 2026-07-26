import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { TaxRatesModule } from '../tax-rates/tax-rates.module';
import { ItemsModule } from '../items/items.module';
import { EmailModule } from '../email/email.module';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PURCHASE_ORDER_REPOSITORY } from './repositories/tokens';
import { PrismaPurchaseOrderRepository } from './repositories/prisma/prisma-purchase-order.repository';

@Module({
  imports: [
    RbacModule,
    TenancyModule,
    SuppliersModule,
    CurrenciesModule,
    ExchangeRatesModule,
    TaxRatesModule,
    // ItemsModule: resolving line-item names for the PDF. EmailModule: the
    // swappable send-email provider.
    ItemsModule,
    EmailModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    { provide: PURCHASE_ORDER_REPOSITORY, useClass: PrismaPurchaseOrderRepository },
  ],
  // GrnModule (Stage 4) needs this to update POLine.receivedQty and
  // recompute PO status when a GRN is finalized against a PO.
  exports: [PURCHASE_ORDER_REPOSITORY],
})
export class PurchaseOrdersModule {}
