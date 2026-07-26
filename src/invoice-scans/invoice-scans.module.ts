import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { StorageModule } from '../storage/storage.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ItemsModule } from '../items/items.module';
import { InvoiceScansController } from './controllers/invoice-scans.controller';
import { InvoiceScansService } from './services/invoice-scans.service';
import { INVOICE_SCAN_REPOSITORY } from './repositories/tokens';
import { PrismaInvoiceScanRepository } from './repositories/prisma/prisma-invoice-scan.repository';
import { INVOICE_OCR_PROVIDER } from './providers/tokens';
import { DevInvoiceOcrProvider } from './providers/dev-invoice-ocr.provider';

@Module({
  imports: [RbacModule, TenancyModule, StorageModule, SuppliersModule, ItemsModule],
  controllers: [InvoiceScansController],
  providers: [
    InvoiceScansService,
    { provide: INVOICE_SCAN_REPOSITORY, useClass: PrismaInvoiceScanRepository },
    // Swappable per the Repository Pattern precedent — a real vendor OCR
    // provider replaces this without touching InvoiceScansService.
    { provide: INVOICE_OCR_PROVIDER, useClass: DevInvoiceOcrProvider },
  ],
  exports: [INVOICE_SCAN_REPOSITORY],
})
export class InvoiceScansModule {}
