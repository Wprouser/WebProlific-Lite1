import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ItemsModule } from '../items/items.module';
import { StockTransactionsController } from './controllers/stock-transactions.controller';
import { StockTransactionsService } from './services/stock-transactions.service';
import { STOCK_TRANSACTION_REPOSITORY } from './repositories/tokens';
import { PrismaStockTransactionRepository } from './repositories/prisma/prisma-stock-transaction.repository';

@Module({
  imports: [RbacModule, ItemsModule],
  controllers: [StockTransactionsController],
  providers: [
    StockTransactionsService,
    { provide: STOCK_TRANSACTION_REPOSITORY, useClass: PrismaStockTransactionRepository },
  ],
  // FR-16: TenancyModule needs this to check "does this outlet have any
  // transactional history" before allowing a base-currency change.
  exports: [STOCK_TRANSACTION_REPOSITORY],
})
export class StockTransactionsModule {}
