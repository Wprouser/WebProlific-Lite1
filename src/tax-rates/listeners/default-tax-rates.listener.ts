import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OUTLET_CREATED_EVENT, OutletCreatedEvent } from '../../tenancy/events/outlet-created.event';
import { TaxRateRepository } from '../repositories/tax-rate.repository';
import { TAX_RATE_REPOSITORY } from '../repositories/tokens';
import { getDefaultTaxRatesForCurrency } from '../constants/default-tax-rates';

/**
 * Every newly created outlet gets a starter set of tax rates appropriate
 * to its base currency (see default-tax-rates.ts) so the Item form's tax
 * dropdown isn't a dead end before FR-04's Purchase Order/GRN tax config
 * exists — same pattern as items/listeners/default-categories.listener.ts.
 * Not a user action — no ActivityLog entry, same as that listener.
 */
@Injectable()
export class DefaultTaxRatesListener {
  constructor(@Inject(TAX_RATE_REPOSITORY) private readonly taxRateRepository: TaxRateRepository) {}

  @OnEvent(OUTLET_CREATED_EVENT)
  async handle(event: OutletCreatedEvent): Promise<void> {
    const rates = getDefaultTaxRatesForCurrency(event.baseCurrency);
    for (const rate of rates) {
      await this.taxRateRepository.create({ ...rate, outletId: event.outletId });
    }
  }
}
