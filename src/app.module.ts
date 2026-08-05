import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { UsersModule } from './users/users.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ItemsModule } from './items/items.module';
import { StockTransactionsModule } from './stock-transactions/stock-transactions.module';
import { TaxRatesModule } from './tax-rates/tax-rates.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { InvoiceScansModule } from './invoice-scans/invoice-scans.module';
import { GrnModule } from './grn/grn.module';
import { RecipesModule } from './recipes/recipes.module';
import { SalesModule } from './sales/sales.module';
import { AlertsModule } from './alerts/alerts.module';
import { ScopeResolutionGuard } from './tenancy/guards/scope-resolution.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './rbac/guards/roles.guard';
import { FieldRestrictionInterceptor } from './rbac/interceptors/field-restriction.interceptor';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // FR-18's domain-event bus (see ActivityBus) — .forRoot() registers
    // EventEmitter2 as a global provider, so no other module needs to
    // import EventEmitterModule itself.
    EventEmitterModule.forRoot(),
    // FR-07's nightly expiry scan. Registered here rather than inside
    // AlertsModule so there is exactly one scheduler for the whole app, the
    // same reasoning as EventEmitterModule above.
    ScheduleModule.forRoot(),
    PrismaModule,
    TenancyModule,
    AuthModule,
    RbacModule,
    UsersModule,
    ActivityLogModule,
    ItemsModule,
    StockTransactionsModule,
    TaxRatesModule,
    CurrenciesModule,
    ExchangeRatesModule,
    SuppliersModule,
    PurchaseOrdersModule,
    InvoiceScansModule,
    GrnModule,
    RecipesModule,
    SalesModule,
    AlertsModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard populates request.user, ScopeResolutionGuard
    // resolves effective access from it, RolesGuard (FR-11) authorizes
    // against that resolved access.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopeResolutionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: FieldRestrictionInterceptor,
    },
  ],
})
export class AppModule {}
