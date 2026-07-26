import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ExchangeRatesService } from '../services/exchange-rates.service';
import { CreateExchangeRateDto } from '../dto/create-exchange-rate.dto';
import { QueryExchangeRatesDto } from '../dto/query-exchange-rates.dto';
import { Roles } from '../../rbac/decorators/roles.decorator';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Any authenticated user can read, like GET /currencies and GET
  // /tax-rates — no role gate beyond the standard JwtAuthGuard.
  @Get()
  list(@Query() query: QueryExchangeRatesDto) {
    return this.exchangeRatesService.list(query);
  }

  // ExchangeRate has no outletId to scope against — a flat @Roles() check
  // against the caller's effectiveRole (RolesGuard, no @ResourceScope),
  // same pattern as FR-14's GET /users. See RolesGuard's own doc comment.
  @Post()
  @Roles('CHAIN_OWNER', 'PROPERTY_MANAGER')
  async create(@Body() dto: CreateExchangeRateDto, @Req() request: RequestWithAccess) {
    const rate = await this.exchangeRatesService.create(dto);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_EXCHANGE_RATE',
      entityType: 'ExchangeRate',
      entityId: rate.id,
      after: rate,
    });
    return rate;
  }
}
