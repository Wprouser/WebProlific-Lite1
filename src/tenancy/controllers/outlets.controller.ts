import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { OutletsService } from '../services/outlets.service';
import { CreateOutletDto } from '../dto/create-outlet.dto';
import { UpdateOutletDto } from '../dto/update-outlet.dto';
import { UpdateCurrencySettingsDto } from '../dto/update-currency-settings.dto';
import { RequestWithAccess } from '../types/request-with-access';
import { Roles } from '../../rbac/decorators/roles.decorator';
import { ResourceScope } from '../../rbac/decorators/resource-scope.decorator';
import { AuditLogService } from '../../rbac/services/audit-log.service';

@Controller()
export class OutletsController {
  constructor(
    private readonly outletsService: OutletsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('properties/:propertyId/outlets')
  // CHAIN_OWNER or PROPERTY_MANAGER (of this property) can add outlets to
  // it — property-level management authority per spec: FR-00 Business Logic.
  @Roles('CHAIN_OWNER', 'PROPERTY_MANAGER')
  @ResourceScope('property', 'propertyId')
  async create(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateOutletDto,
    @Req() request: RequestWithAccess,
  ) {
    const outlet = await this.outletsService.create(propertyId, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_OUTLET',
      entityType: 'Outlet',
      entityId: outlet.id,
      outletId: outlet.id,
      after: outlet,
    });
    return outlet;
  }

  @Get('outlets/:id')
  @ResourceScope('outlet', 'id')
  findOne(@Param('id') id: string) {
    return this.outletsService.findById(id);
  }

  @Patch('outlets/:id')
  // CHAIN_OWNER, PROPERTY_MANAGER (inherited via their property), or
  // OUTLET_MANAGER (of this outlet directly) — spec: FR-00 Business Logic.
  @Roles('CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER')
  @ResourceScope('outlet', 'id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOutletDto,
    @Req() request: RequestWithAccess,
  ) {
    const before = await this.outletsService.findById(id);
    const after = await this.outletsService.update(id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_OUTLET',
      entityType: 'Outlet',
      entityId: id,
      outletId: id,
      before,
      after,
    });
    return after;
  }

  @Get('outlets/:id/currency-settings')
  @ResourceScope('outlet', 'id')
  getCurrencySettings(@Param('id') id: string) {
    return this.outletsService.getCurrencySettings(id);
  }

  @Patch('outlets/:id/currency-settings')
  // CHAIN_OWNER only — narrower than the generic outlet-settings PATCH
  // above, per spec: FR-16 Business Logic ("heavily restricted").
  @Roles('CHAIN_OWNER')
  @ResourceScope('outlet', 'id')
  async updateCurrencySettings(
    @Param('id') id: string,
    @Body() dto: UpdateCurrencySettingsDto,
    @Req() request: RequestWithAccess,
  ) {
    const before = await this.outletsService.getCurrencySettings(id);
    const after = await this.outletsService.updateCurrencySettings(id, dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPDATE_OUTLET_CURRENCY_SETTINGS',
      entityType: 'Outlet',
      entityId: id,
      outletId: id,
      before,
      after,
    });
    return after;
  }
}
