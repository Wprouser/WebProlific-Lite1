import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_MEASURE_REPOSITORY } from '../repositories/tokens';
import { UnitOfMeasureRepository } from '../repositories/unit-of-measure.repository';
import { UnitOfMeasure } from '../domain/unit-of-measure.entity';
import { CreateUnitOfMeasureDto } from '../dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from '../dto/update-unit-of-measure.dto';
import { QueryUnitsDto } from '../dto/query-units.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';

const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'] as const;

@Injectable()
export class UnitsService {
  constructor(@Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository) {}

  async create(request: RequestWithAccess, dto: CreateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    assertOutletAccess(request, dto.outletId, [...MUTATE_ROLES]);

    const existing = await this.unitRepository.findByNameAndOutlet(dto.name, dto.outletId);
    if (existing) throw new ConflictException('A unit of measure with this name already exists for this outlet');

    const baseUnitId = dto.baseUnitId ?? null;
    const conversionFactor = dto.conversionFactor ?? null;
    if (baseUnitId) {
      await this.assertValidBaseUnit(baseUnitId, dto.outletId, conversionFactor);
    } else {
      this.assertPairing(conversionFactor);
    }

    return this.unitRepository.create(dto);
  }

  async findById(request: RequestWithAccess, id: string): Promise<UnitOfMeasure> {
    const unit = await this.getOrThrow(id);
    assertOutletAccess(request, unit.outletId);
    return unit;
  }

  async update(request: RequestWithAccess, id: string, dto: UpdateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);

    // Merge onto the existing row — a PATCH may send only one of the pair,
    // but the pairing/flat-hierarchy rules must be checked against the
    // *effective* resulting state, not just whatever this one call sent.
    const effectiveBaseUnitId = dto.baseUnitId !== undefined ? dto.baseUnitId : existing.baseUnitId;
    const effectiveConversionFactor =
      dto.conversionFactor !== undefined ? dto.conversionFactor : existing.conversionFactor;

    if (effectiveBaseUnitId) {
      if (effectiveBaseUnitId === id) {
        throw new BadRequestException('A unit cannot be its own base unit');
      }
      // Re-parenting guard: if this unit is currently used as someone else's
      // base (it has derived units), it must itself stay a base unit — by
      // the flat-hierarchy invariant, anything already pointing to it as a
      // base already required *this* unit's own baseUnitId to be null at
      // the time it was created/edited, so giving it one now would
      // retroactively turn those into an illegal 3-level chain.
      const dependents = await this.unitRepository.findByBaseUnitId(id);
      if (dependents.length > 0) {
        throw new BadRequestException(
          'This unit is already used as the base for other units and cannot be given a base unit of its own',
        );
      }
      await this.assertValidBaseUnit(effectiveBaseUnitId, existing.outletId, effectiveConversionFactor);
    } else {
      this.assertPairing(effectiveConversionFactor);
    }

    return this.unitRepository.update(id, dto);
  }

  /**
   * Spec: soft-deactivate only, same as Item/TaxRate — a unit may already be
   * referenced by historical Items and must remain meaningful in that
   * historical context. Deactivating never affects any Item already using
   * it — it only stops appearing as an option for new/edited items.
   */
  async deactivate(request: RequestWithAccess, id: string): Promise<UnitOfMeasure> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);

    return this.unitRepository.update(id, { isActive: false });
  }

  async list(request: RequestWithAccess, query: QueryUnitsDto): Promise<UnitOfMeasure[]> {
    return this.unitRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  /** Only reached when baseUnitId is null/absent — conversionFactor must be
   * too (spec: "a base unit has nothing to convert from"). */
  private assertPairing(conversionFactor: string | null): void {
    if (conversionFactor) {
      throw new BadRequestException('conversionFactor requires a baseUnitId to be set');
    }
  }

  /**
   * Spec's full conversion rule set, checked whenever baseUnitId is being
   * set to a real value:
   * - conversionFactor is required and must be > 0.
   * - The referenced unit must exist and belong to the same outlet.
   * - The referenced unit must itself be a base unit (baseUnitId: null) —
   *   the flat, two-level-only hierarchy: a derived unit can never point to
   *   another derived unit.
   */
  private async assertValidBaseUnit(
    baseUnitId: string,
    outletId: string,
    conversionFactor: string | null,
  ): Promise<void> {
    if (!conversionFactor || Number(conversionFactor) <= 0) {
      throw new BadRequestException('conversionFactor is required and must be greater than 0 when baseUnitId is set');
    }

    const baseUnit = await this.unitRepository.findById(baseUnitId);
    if (!baseUnit || baseUnit.outletId !== outletId) {
      throw new BadRequestException(`Base unit ${baseUnitId} not found for this outlet`);
    }
    if (baseUnit.baseUnitId !== null) {
      throw new BadRequestException(
        'baseUnitId must point to a genuine base unit — a unit that is itself derived cannot be used as a base (only a flat, two-level hierarchy is allowed)',
      );
    }
  }

  private async getOrThrow(id: string): Promise<UnitOfMeasure> {
    const unit = await this.unitRepository.findById(id);
    if (!unit) throw new NotFoundException(`Unit of measure ${id} not found`);
    return unit;
  }
}
