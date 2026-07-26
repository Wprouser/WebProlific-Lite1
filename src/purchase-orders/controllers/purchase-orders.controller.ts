import { Body, Controller, Get, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from '../dto/update-purchase-order.dto';
import { RejectPurchaseOrderDto } from '../dto/reject-purchase-order.dto';
import { QueryPurchaseOrdersDto } from '../dto/query-purchase-orders.dto';
import { SendEmailDto } from '../../documents/dto/send-email.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — FR-04's endpoints are flat, same
// reasoning as ItemsController/SuppliersController; authorization is fully
// enforced inside PurchaseOrdersService via assertOutletAccess.
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async create(@Body() dto: CreatePurchaseOrderDto, @Req() request: RequestWithAccess) {
    const po = await this.purchaseOrdersService.create(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      outletId: po.outletId,
      after: po,
    });
    return po;
  }

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QueryPurchaseOrdersDto) {
    return this.purchaseOrdersService.list(request, query);
  }

  @Get(':id')
  findOne(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.purchaseOrdersService.findById(request, id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.update(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/submit')
  async submit(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.submit(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'SUBMIT_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.approve(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'APPROVE_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectPurchaseOrderDto, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.reject(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'REJECT_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      // `reason` has no PurchaseOrder column (see the service's own doc
      // comment) — captured here in the audit trail's `after` payload
      // instead, so "why" is never lost even though it's not a schema field.
      after: { ...after, rejectionReason: dto.reason },
    });
    return after;
  }

  @Patch(':id/send')
  async send(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.send(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'SEND_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Patch(':id/close')
  async close(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.close(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CLOSE_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Req() request: RequestWithAccess): Promise<StreamableFile> {
    const buffer = await this.purchaseOrdersService.generatePdf(request, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="PO-${id.slice(0, 8).toUpperCase()}.pdf"`,
    });
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @Body() dto: SendEmailDto, @Req() request: RequestWithAccess) {
    const before = await this.purchaseOrdersService.findById(request, id);
    const after = await this.purchaseOrdersService.sendEmail(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'EMAIL_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }
}
