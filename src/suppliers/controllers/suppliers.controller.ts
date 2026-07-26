import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { QuerySuppliersDto } from '../dto/query-suppliers.dto';
import { QuerySupplierPriceHistoryDto } from '../dto/query-supplier-price-history.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

// No `@Roles()`/`@ResourceScope()` — FR-03's endpoints are flat (no
// /outlets/:outletId/suppliers nesting), same reasoning as ItemsController;
// authorization is fully enforced inside SuppliersService via
// assertOutletAccess.
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async create(@Body() dto: CreateSupplierDto, @Req() request: RequestWithAccess) {
    const supplier = await this.suppliersService.create(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: supplier.id,
      outletId: supplier.outletId,
      after: supplier,
    });
    return supplier;
  }

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QuerySuppliersDto) {
    return this.suppliersService.list(request, query);
  }

  @Get(':id')
  findOne(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.suppliersService.findById(request, id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @Req() request: RequestWithAccess) {
    const before = await this.suppliersService.findById(request, id);
    const after = await this.suppliersService.update(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.suppliersService.findById(request, id);
    const after = await this.suppliersService.deactivate(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'DEACTIVATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Get(':id/price-history')
  priceHistory(
    @Req() request: RequestWithAccess,
    @Param('id') id: string,
    @Query() query: QuerySupplierPriceHistoryDto,
  ) {
    return this.suppliersService.priceHistory(request, id, query.itemId);
  }

  @Get(':id/performance')
  performance(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.suppliersService.performance(request, id);
  }
}
