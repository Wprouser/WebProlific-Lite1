import { Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AlertsService } from '../services/alerts.service';
import { QueryAlertsDto } from '../dto/query-alerts.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — these routes are flat, so the outletId
// isn't in the path for the guard to resolve. Authorization happens in
// AlertsService via assertOutletAccess once the alert's outlet is known, the
// same pattern as Items/Stock/Recipes/Sales.
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QueryAlertsDto) {
    return this.alertsService.list(request, query);
  }

  /**
   * Counts for FR-17's Global Alert Bar. Not in FR-07's endpoint table: the
   * bar is specced in FR-17 and has been reading mock data since, with no
   * endpoint able to answer it. Spans FR-07 alerts and FR-04's PO/GRN states
   * because the bar shows both.
   */
  @Get('summary')
  summary(@Req() request: RequestWithAccess, @Query('outletId') outletId?: string) {
    return this.alertsService.summarize(request, outletId);
  }

  @Patch(':id/acknowledge')
  async acknowledge(@Req() request: RequestWithAccess, @Param('id') id: string) {
    const alert = await this.alertsService.acknowledge(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'ACKNOWLEDGE_ALERT',
      entityType: 'Alert',
      entityId: id,
      outletId: alert.outletId,
      after: alert,
    });
    return alert;
  }

  @Patch(':id/resolve')
  async resolve(@Req() request: RequestWithAccess, @Param('id') id: string) {
    const alert = await this.alertsService.resolve(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'RESOLVE_ALERT',
      entityType: 'Alert',
      entityId: id,
      outletId: alert.outletId,
      after: alert,
    });
    return alert;
  }

  /** Reorder shortcut: a DRAFT PO pre-filled from the alerting item. The PO
   * service writes its own audit entry for the creation. */
  @Post(':id/create-po-draft')
  createPoDraft(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.alertsService.createPoDraft(request, id);
  }
}
