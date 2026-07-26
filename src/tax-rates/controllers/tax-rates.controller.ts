import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { TaxRatesService } from '../services/tax-rates.service';
import { CreateTaxRateDto } from '../dto/create-tax-rate.dto';
import { UpdateTaxRateDto } from '../dto/update-tax-rate.dto';
import { QueryTaxRatesDto } from '../dto/query-tax-rates.dto';
import { PreviewTaxRateDto } from '../dto/preview-tax-rate.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

@Controller('tax-rates')
export class TaxRatesController {
  constructor(
    private readonly taxRatesService: TaxRatesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async create(@Body() dto: CreateTaxRateDto, @Req() request: RequestWithAccess) {
    const taxRate = await this.taxRatesService.create(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_TAX_RATE',
      entityType: 'TaxRate',
      entityId: taxRate.id,
      outletId: taxRate.outletId,
      after: taxRate,
    });
    return taxRate;
  }

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QueryTaxRatesDto) {
    return this.taxRatesService.list(request, query);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTaxRateDto,
    @Req() request: RequestWithAccess,
  ) {
    const before = await this.taxRatesService.findById(request, id);
    const after = await this.taxRatesService.update(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_TAX_RATE',
      entityType: 'TaxRate',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Post(':id/preview')
  // Demo/preview utility only — computes tax on a caller-supplied subtotal
  // without persisting anything. Stands in for a real PO/GRN line (FR-03/04
  // aren't built yet) so the compound-tax calculation and itemized
  // breakdown can still be exercised end-to-end today.
  preview(
    @Param('id') id: string,
    @Body() dto: PreviewTaxRateDto,
    @Req() request: RequestWithAccess,
  ) {
    return this.taxRatesService.preview(request, id, dto.subtotal);
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.taxRatesService.findById(request, id);
    const after = await this.taxRatesService.deactivate(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'DEACTIVATE_TAX_RATE',
      entityType: 'TaxRate',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }
}
