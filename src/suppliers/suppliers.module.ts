import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { SuppliersController } from './controllers/suppliers.controller';
import { SuppliersService } from './services/suppliers.service';
import { SUPPLIER_REPOSITORY, SUPPLIER_PRICE_HISTORY_REPOSITORY } from './repositories/tokens';
import { PrismaSupplierRepository } from './repositories/prisma/prisma-supplier.repository';
import { PrismaSupplierPriceHistoryRepository } from './repositories/prisma/prisma-supplier-price-history.repository';

@Module({
  imports: [RbacModule, CurrenciesModule],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    { provide: SUPPLIER_REPOSITORY, useClass: PrismaSupplierRepository },
    { provide: SUPPLIER_PRICE_HISTORY_REPOSITORY, useClass: PrismaSupplierPriceHistoryRepository },
  ],
  // FR-04: PurchaseOrdersModule/GrnModule need SUPPLIER_REPOSITORY to
  // validate a PO/GRN's supplierId belongs to the same outlet, and
  // SUPPLIER_PRICE_HISTORY_REPOSITORY so GRN finalization can finally write
  // the rows FR-03 modeled ahead of time.
  exports: [SUPPLIER_REPOSITORY, SUPPLIER_PRICE_HISTORY_REPOSITORY],
})
export class SuppliersModule {}
