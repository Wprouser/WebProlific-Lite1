import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TAX_RATE_REPOSITORY } from '../repositories/tokens';
import { TaxRateRepository, TaxRateComponentInput } from '../repositories/tax-rate.repository';
import { TaxRate } from '../domain/tax-rate.entity';
import { CreateTaxRateDto } from '../dto/create-tax-rate.dto';
import { UpdateTaxRateDto } from '../dto/update-tax-rate.dto';
import { QueryTaxRatesDto } from '../dto/query-tax-rates.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { applyTaxRate, ApplyTaxRateResult } from '../lib/apply-tax-rate';

// Narrower than Item/Category's MUTATE_ROLES (which also allows
// OUTLET_MANAGER) — per FR-04 spec's Tax Configuration section, tax-rate
// mutations are explicitly PROPERTY_MANAGER/CHAIN_OWNER only, a
// property/chain-level policy decision rather than a per-outlet one.
const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER'] as const;

@Injectable()
export class TaxRatesService {
  constructor(@Inject(TAX_RATE_REPOSITORY) private readonly taxRateRepository: TaxRateRepository) {}

  async create(request: RequestWithAccess, dto: CreateTaxRateDto): Promise<TaxRate> {
    assertOutletAccess(request, dto.outletId, [...MUTATE_ROLES]);
    this.assertRatePercentInRange(dto.ratePercent);
    this.assertComponentsValid(dto.isCompound ?? false, dto.ratePercent, dto.components);

    return this.taxRateRepository.create(dto);
  }

  async findById(request: RequestWithAccess, id: string): Promise<TaxRate> {
    const taxRate = await this.getOrThrow(id);
    assertOutletAccess(request, taxRate.outletId);
    return taxRate;
  }

  async update(request: RequestWithAccess, id: string, dto: UpdateTaxRateDto): Promise<TaxRate> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);

    const effectiveRatePercent = dto.ratePercent ?? existing.ratePercent;
    const effectiveIsCompound = dto.isCompound ?? existing.isCompound;
    this.assertRatePercentInRange(effectiveRatePercent);

    // Switching a rate from compound back to simple must clear its old
    // components even if the caller didn't explicitly send an empty list —
    // otherwise orphaned TaxRateComponent rows would linger under a rate
    // that's no longer marked compound. Computed before validation so the
    // check below sees the *intended* final component set, not whatever
    // still exists on the (about-to-be-overwritten) row.
    const componentsToSave = dto.isCompound === false ? [] : dto.components;
    const effectiveComponents =
      componentsToSave ??
      existing.components.map((c) => ({ componentName: c.componentName, componentRate: c.componentRate }));
    this.assertComponentsValid(effectiveIsCompound, effectiveRatePercent, effectiveComponents);

    return this.taxRateRepository.update(id, { ...dto, components: componentsToSave });
  }

  /**
   * Spec: soft-deactivate only, same as Item/Category — a tax rate may
   * already be referenced by historical PO/GRN lines (once those exist)
   * and must remain meaningful in that historical context. "Cannot
   * deactivate the last active rate" is explicitly a UI-level confirmation
   * warning per spec, not a hard block — so this never rejects the request,
   * it always just deactivates.
   */
  async deactivate(request: RequestWithAccess, id: string): Promise<TaxRate> {
    const existing = await this.getOrThrow(id);
    assertOutletAccess(request, existing.outletId, [...MUTATE_ROLES]);

    return this.taxRateRepository.update(id, { isActive: false });
  }

  async list(request: RequestWithAccess, query: QueryTaxRatesDto): Promise<TaxRate[]> {
    return this.taxRateRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  /**
   * Demo/preview utility — computes what a line with this subtotal would
   * owe in tax, without persisting anything. There's no real PO/GRN line
   * to apply this to yet (FR-03/04 aren't built), so this is how the
   * compound-tax calculation and itemized breakdown get exercised today;
   * FR-04's real line-creation logic will call the same `applyTaxRate`
   * function this delegates to.
   */
  async preview(request: RequestWithAccess, id: string, subtotal: string): Promise<ApplyTaxRateResult & { lineSubtotal: string }> {
    const taxRate = await this.findById(request, id);
    const result = applyTaxRate(subtotal, taxRate);
    return { lineSubtotal: new Prisma.Decimal(subtotal).toFixed(2), ...result };
  }

  private assertRatePercentInRange(ratePercent: string): void {
    const value = Number(ratePercent);
    if (value < 0 || value > 100) {
      throw new BadRequestException('ratePercent must be between 0 and 100');
    }
  }

  private assertComponentsValid(
    isCompound: boolean,
    ratePercent: string,
    components: TaxRateComponentInput[] | undefined,
  ): void {
    if (!isCompound) {
      if (components && components.length > 0) {
        throw new BadRequestException('Components can only be set on a compound tax rate');
      }
      return;
    }

    // At least 1, not 2 — India's inter-state GST (IGST) is legitimately a
    // single component; the form's default UI state nudges toward 2 rows
    // for the common CGST+SGST case, but that's a UI default, not a save
    // constraint enforced here.
    if (!components || components.length === 0) {
      throw new BadRequestException('A compound tax rate requires at least one component');
    }
    for (const component of components) {
      this.assertRatePercentInRange(component.componentRate);
    }

    const sum = components.reduce(
      (acc, c) => acc.plus(new Prisma.Decimal(c.componentRate)),
      new Prisma.Decimal(0),
    );
    const rate = new Prisma.Decimal(ratePercent);
    if (!sum.equals(rate)) {
      throw new BadRequestException(
        `Components sum to ${sum.toFixed(2)}%, but the tax rate is ${rate.toFixed(2)}% — adjust the components to match.`,
      );
    }
  }

  private async getOrThrow(id: string): Promise<TaxRate> {
    const taxRate = await this.taxRateRepository.findById(id);
    if (!taxRate) throw new NotFoundException(`Tax rate ${id} not found`);
    return taxRate;
  }
}
