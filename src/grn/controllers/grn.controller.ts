import { Body, Controller, Get, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { GrnService } from '../services/grn.service';
import { CreateDirectGrnDto } from '../dto/create-direct-grn.dto';
import { CreatePoGrnDto } from '../dto/create-po-grn.dto';
import { QueryGrnDto } from '../dto/query-grn.dto';
import { SendEmailDto } from '../../documents/dto/send-email.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — same reasoning as
// PurchaseOrdersController; authorization is fully enforced inside
// GrnService via assertOutletAccess.
@Controller()
export class GrnController {
  constructor(
    private readonly grnService: GrnService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('grn/direct')
  async createDirect(@Body() dto: CreateDirectGrnDto, @Req() request: RequestWithAccess) {
    const grn = await this.grnService.createDirect(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_GRN_DIRECT',
      entityType: 'GRN',
      entityId: grn.id,
      outletId: grn.outletId,
      after: grn,
    });
    return grn;
  }

  @Post('purchase-orders/:id/grn')
  async createAgainstPo(@Param('id') id: string, @Body() dto: CreatePoGrnDto, @Req() request: RequestWithAccess) {
    const grn = await this.grnService.createAgainstPo(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_GRN_AGAINST_PO',
      entityType: 'GRN',
      entityId: grn.id,
      outletId: grn.outletId,
      after: grn,
    });
    return grn;
  }

  @Get('grn')
  list(@Req() request: RequestWithAccess, @Query() query: QueryGrnDto) {
    return this.grnService.list(request, query);
  }

  @Get('grn/:id')
  findOne(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.grnService.findById(request, id);
  }

  @Get('grn/:id/pdf')
  async getPdf(@Param('id') id: string, @Req() request: RequestWithAccess): Promise<StreamableFile> {
    const buffer = await this.grnService.generatePdf(request, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="GRN-${id.slice(0, 8).toUpperCase()}.pdf"`,
    });
  }

  @Post('grn/:id/send-email')
  async sendEmail(@Param('id') id: string, @Body() dto: SendEmailDto, @Req() request: RequestWithAccess) {
    const before = await this.grnService.findById(request, id);
    const after = await this.grnService.sendEmail(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'EMAIL_GRN',
      entityType: 'GRN',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }
}
