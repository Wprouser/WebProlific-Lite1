import { Controller, Get } from '@nestjs/common';
import { CurrenciesService } from '../services/currencies.service';

// Any authenticated user can read — global reference data, no role gate
// beyond the standard JwtAuthGuard, same as GET /tax-rates.
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  list() {
    return this.currenciesService.list();
  }
}
