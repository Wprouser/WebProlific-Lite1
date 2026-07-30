import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { UnitsService } from '../services/units.service';
import { CreateUnitOfMeasureDto } from '../dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from '../dto/update-unit-of-measure.dto';
import { QueryUnitsDto } from '../dto/query-units.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

/**
 * Registered ahead of ItemsController in ItemsModule, same reasoning as
 * CategoriesController — `GET/POST items/units` must resolve before
 * ItemsController's `GET items/:id` would otherwise treat "units" as an
 * item id.
 */
@Controller('items/units')
export class UnitsController {
  constructor(
    private readonly unitsService: UnitsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  async create(@Body() dto: CreateUnitOfMeasureDto, @Req() request: RequestWithAccess) {
    const unit = await this.unitsService.create(request, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_UNIT_OF_MEASURE',
      entityType: 'UnitOfMeasure',
      entityId: unit.id,
      outletId: unit.outletId,
      after: unit,
    });
    return unit;
  }

  @Get()
  list(@Req() request: RequestWithAccess, @Query() query: QueryUnitsDto) {
    return this.unitsService.list(request, query);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUnitOfMeasureDto, @Req() request: RequestWithAccess) {
    const before = await this.unitsService.findById(request, id);
    const after = await this.unitsService.update(request, id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_UNIT_OF_MEASURE',
      entityType: 'UnitOfMeasure',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string, @Req() request: RequestWithAccess) {
    const before = await this.unitsService.findById(request, id);
    const after = await this.unitsService.deactivate(request, id);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'DEACTIVATE_UNIT_OF_MEASURE',
      entityType: 'UnitOfMeasure',
      entityId: id,
      outletId: after.outletId,
      before,
      after,
    });
    return after;
  }
}
