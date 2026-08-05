import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ItemsModule } from '../items/items.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { StockTransactionsController } from './controllers/stock-transactions.controller';
import { StockTransactionsService } from './services/stock-transactions.service';
import { STOCK_TRANSACTION_REPOSITORY } from './repositories/tokens';
import { PrismaStockTransactionRepository } from './repositories/prisma/prisma-stock-transaction.repository';

@Module({
  imports: [RbacModule, ItemsModule, ActivityLogModule],
  controllers: [StockTransactionsController],
  providers: [
    StockTransactionsService,
    { provide: STOCK_TRANSACTION_REPOSITORY, useClass: PrismaStockTransactionRepository },
  ],
  // FR-16: TenancyModule needs the repository to check "does this outlet
  // have any transactional history" before allowing a base-currency change.
  // FR-06: SalesModule needs the service — every POS deduction goes through
  // createSystem() rather than reaching for the repository directly, so the
  // ledger keeps exactly one write path.
  exports: [STOCK_TRANSACTION_REPOSITORY, StockTransactionsService],
})
export class StockTransactionsModule {}
