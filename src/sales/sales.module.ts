import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ItemsModule } from '../items/items.module';
import { RecipesModule } from '../recipes/recipes.module';
import { StockTransactionsModule } from '../stock-transactions/stock-transactions.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { PosWebhookController } from './controllers/pos-webhook.controller';
import { SalesController } from './controllers/sales.controller';
import { SaleImportBatchesController } from './controllers/sale-import-batches.controller';
import { SalesService } from './services/sales.service';
import { SaleDeductionService } from './services/sale-deduction.service';
import { SaleImportService } from './services/sale-import.service';
import { PosSignatureGuard } from './guards/pos-signature.guard';
import { SALE_IMPORT_REPOSITORY, SALE_REPOSITORY } from './repositories/tokens';
import { PrismaSaleRepository } from './repositories/prisma/prisma-sale.repository';
import { PrismaSaleImportRepository } from './repositories/prisma/prisma-sale-import.repository';

/**
 * FR-06. Imports rather than reimplements:
 * - RecipesModule for MENU_ITEM_REPOSITORY/RECIPE_REPOSITORY/RecipeCostService,
 *   so a sale resolves through exactly the same tree walk the cost screen uses.
 * - StockTransactionsModule for StockTransactionsService.createSystem — the
 *   ledger keeps one write path, whether a human or a webhook caused the
 *   movement.
 * - ItemsModule for ITEM_REPOSITORY, used by the impact preview.
 */
@Module({
  imports: [RbacModule, ItemsModule, RecipesModule, StockTransactionsModule, ActivityLogModule],
  controllers: [PosWebhookController, SalesController, SaleImportBatchesController],
  providers: [
    SalesService,
    SaleDeductionService,
    SaleImportService,
    PosSignatureGuard,
    { provide: SALE_REPOSITORY, useClass: PrismaSaleRepository },
    { provide: SALE_IMPORT_REPOSITORY, useClass: PrismaSaleImportRepository },
  ],
})
export class SalesModule {}
