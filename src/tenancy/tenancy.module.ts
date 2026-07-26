import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { StockTransactionsModule } from '../stock-transactions/stock-transactions.module';
import { ChainsController } from './controllers/chains.controller';
import { PropertiesController } from './controllers/properties.controller';
import { OutletsController } from './controllers/outlets.controller';
import { ChainsService } from './services/chains.service';
import { PropertiesService } from './services/properties.service';
import { OutletsService } from './services/outlets.service';
import { ScopeResolutionService } from './services/scope-resolution.service';
import { ScopeResolutionGuard } from './guards/scope-resolution.guard';
import {
  CHAIN_REPOSITORY,
  OUTLET_REPOSITORY,
  PROPERTY_REPOSITORY,
  USER_ACCESS_REPOSITORY,
} from './repositories/tokens';
import { PrismaChainRepository } from './repositories/prisma/prisma-chain.repository';
import { PrismaPropertyRepository } from './repositories/prisma/prisma-property.repository';
import { PrismaOutletRepository } from './repositories/prisma/prisma-outlet.repository';
import { PrismaUserAccessRepository } from './repositories/prisma/prisma-user-access.repository';

@Module({
  // FR-16: OutletsService needs CurrenciesModule (validating baseCurrency
  // against the real registry) and StockTransactionsModule (checking
  // "does this outlet have any transactional history" before allowing a
  // base-currency change). Neither imports TenancyModule back — verified
  // no circular dependency (StockTransactionsModule -> ItemsModule ->
  // RbacModule/StorageModule only).
  imports: [RbacModule, CurrenciesModule, StockTransactionsModule],
  controllers: [ChainsController, PropertiesController, OutletsController],
  providers: [
    ChainsService,
    PropertiesService,
    OutletsService,
    ScopeResolutionService,
    ScopeResolutionGuard,
    { provide: CHAIN_REPOSITORY, useClass: PrismaChainRepository },
    { provide: PROPERTY_REPOSITORY, useClass: PrismaPropertyRepository },
    { provide: OUTLET_REPOSITORY, useClass: PrismaOutletRepository },
    { provide: USER_ACCESS_REPOSITORY, useClass: PrismaUserAccessRepository },
  ],
  exports: [
    ScopeResolutionService,
    ScopeResolutionGuard,
    PROPERTY_REPOSITORY,
    OUTLET_REPOSITORY,
    USER_ACCESS_REPOSITORY,
  ],
})
export class TenancyModule {}
