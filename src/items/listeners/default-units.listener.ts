import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OUTLET_CREATED_EVENT, OutletCreatedEvent } from '../../tenancy/events/outlet-created.event';
import { UnitOfMeasureRepository } from '../repositories/unit-of-measure.repository';
import { UNIT_OF_MEASURE_REPOSITORY } from '../repositories/tokens';
import { DEFAULT_BASE_UNITS, DEFAULT_DERIVED_UNITS } from '../constants/default-units';

/**
 * Every newly created outlet gets a starter set of units of measure (see
 * default-units.ts) so a new customer can add their first item without
 * first having to build out a units taxonomy from scratch — same pattern
 * as DefaultCategoriesListener. Not a user action — no ActivityLog entry,
 * same as other system-initiated setup.
 *
 * Two passes, not one loop: base units must exist (with real ids) before
 * the derived units that reference them can be created.
 */
@Injectable()
export class DefaultUnitsListener {
  constructor(@Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository) {}

  @OnEvent(OUTLET_CREATED_EVENT)
  async handle(event: OutletCreatedEvent): Promise<void> {
    const baseUnitIdByName = new Map<string, string>();
    for (const { name, abbreviation } of DEFAULT_BASE_UNITS) {
      const unit = await this.unitRepository.create({ name, abbreviation, outletId: event.outletId });
      baseUnitIdByName.set(name, unit.id);
    }

    for (const { name, abbreviation, baseUnitName, conversionFactor } of DEFAULT_DERIVED_UNITS) {
      const baseUnitId = baseUnitIdByName.get(baseUnitName)!;
      await this.unitRepository.create({
        name,
        abbreviation,
        outletId: event.outletId,
        baseUnitId,
        conversionFactor,
      });
    }
  }
}
