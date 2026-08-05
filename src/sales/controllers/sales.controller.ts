import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { SalesService } from '../services/sales.service';
import { CreateManualSaleDto } from '../dto/create-manual-sale.dto';
import { QuerySalesDto } from '../dto/query-sales.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — these routes are flat, so the outletId
// isn't in the path for the guard to resolve. Authorization happens in
// SalesService via assertOutletAccess once the sale's outlet is known, the
// same pattern as Items/Stock/Recipes.
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QuerySalesDto) {
    return this.salesService.list(request, query);
  }

  /** FR-06 Screens: the Unmapped Items worklist — sold, but no recipe to
   * deduct through. Aggregated per menu item, newest activity first. */
  @Get('unmapped')
  listUnmapped(@Req() request: RequestWithAccess, @Query('outletId') outletId?: string) {
    return this.salesService.listUnmapped(request, outletId);
  }

  @Post('manual')
  async createManual(@Req() request: RequestWithAccess, @Body() dto: CreateManualSaleDto) {
    const result = await this.salesService.createManualSale(request, dto);
    // Unlike the webhook path, this one has a real user behind it, so it
    // gets the full FR-11 audit entry as well as the FR-18 activity events
    // the deduction itself emits.
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_SALE',
      entityType: 'Sale',
      entityId: result.sale.id,
      outletId: result.sale.outletId,
      after: result.sale,
    });
    return {
      sale: result.sale,
      deducted: result.deducted,
      warnings: result.warnings.map((warning) => ({ code: warning.action, message: warning.message })),
    };
  }
}
