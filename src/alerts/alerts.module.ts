import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ItemsModule } from '../items/items.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { AlertsController } from './controllers/alerts.controller';
import { AlertsService } from './services/alerts.service';
import { StockAlertListener } from './listeners/stock-alert.listener';
import { ExpiryScanJob } from './jobs/expiry-scan.job';
import { ALERT_REPOSITORY } from './repositories/tokens';
import { PrismaAlertRepository } from './repositories/prisma/prisma-alert.repository';

/**
 * FR-07. Imports rather than reimplements:
 * - ItemsModule for ITEM_REPOSITORY — alert messages name the item, and the
 *   PO shortcut reads its supplier, max stock and price from it.
 * - PurchaseOrdersModule for the create-PO-draft shortcut, so there is one
 *   PO assembly path rather than two.
 * - ActivityLogModule so every raised alert lands in the FR-18 feed with a
 *   null actor, the same system-generated shape FR-06's warnings use.
 */
@Module({
  imports: [RbacModule, ItemsModule, PurchaseOrdersModule, ActivityLogModule],
  controllers: [AlertsController],
  providers: [
    AlertsService,
    StockAlertListener,
    ExpiryScanJob,
    { provide: ALERT_REPOSITORY, useClass: PrismaAlertRepository },
  ],
  // Exported so the expiry scan can be invoked directly — by the e2e suite,
  // and by any future admin "run it now" action. Waiting for 2am is not a
  // testing strategy.
  exports: [AlertsService],
})
export class AlertsModule {}
