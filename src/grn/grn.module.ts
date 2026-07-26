import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { TaxRatesModule } from '../tax-rates/tax-rates.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { InvoiceScansModule } from '../invoice-scans/invoice-scans.module';
import { ItemsModule } from '../items/items.module';
import { EmailModule } from '../email/email.module';
import { GrnController } from './controllers/grn.controller';
import { GrnService } from './services/grn.service';
import { GRN_REPOSITORY } from './repositories/tokens';
import { PrismaGrnRepository } from './repositories/prisma/prisma-grn.repository';

@Module({
  imports: [
    RbacModule,
    TenancyModule,
    SuppliersModule,
    CurrenciesModule,
    ExchangeRatesModule,
    TaxRatesModule,
    // For PURCHASE_ORDER_REPOSITORY (PO lookup/status validation in
    // GrnService, and PrismaGrnRepository's applyGrnReceipt call) — a
    // one-directional import; PurchaseOrdersModule never imports GrnModule
    // back, so there's no cycle.
    PurchaseOrdersModule,
    // For INVOICE_SCAN_REPOSITORY — resolving an invoiceScanId's file url
    // onto a confirmed GRN (Flow 3). One-directional import.
    InvoiceScansModule,
    // ItemsModule: resolving line-item names for the PDF. EmailModule: the
    // swappable send-email provider.
    ItemsModule,
    EmailModule,
  ],
  controllers: [GrnController],
  providers: [GrnService, { provide: GRN_REPOSITORY, useClass: PrismaGrnRepository }],
})
export class GrnModule {}
