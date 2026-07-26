import { Injectable } from '@nestjs/common';
import {
  TaxRate as PrismaTaxRate,
  TaxRateComponent as PrismaTaxRateComponent,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TaxRate, TaxRateComponent } from '../../domain/tax-rate.entity';
import {
  CreateTaxRateInput,
  TaxRateComponentInput,
  TaxRateFilters,
  TaxRateRepository,
  UpdateTaxRateInput,
} from '../tax-rate.repository';

type PrismaTaxRateWithComponents = PrismaTaxRate & { components: PrismaTaxRateComponent[] };

function componentToDomain(row: PrismaTaxRateComponent): TaxRateComponent {
  return {
    id: row.id,
    taxRateId: row.taxRateId,
    componentName: row.componentName,
    componentRate: row.componentRate.toFixed(2),
    sortOrder: row.sortOrder,
  };
}

// sortOrder is the caller's array position, not client-supplied — this is
// the one place it's assigned, on both create() and update()'s wholesale
// replace, so it always matches the order the components were given in.
function toComponentCreateData(components: TaxRateComponentInput[]) {
  return components.map((c, index) => ({
    componentName: c.componentName,
    componentRate: c.componentRate,
    sortOrder: index,
  }));
}

function toDomain(row: PrismaTaxRateWithComponents): TaxRate {
  return {
    id: row.id,
    outletId: row.outletId,
    name: row.name,
    // .toFixed(2), not .toString() — matches the project's fixed-precision
    // convention for Decimal fields (see e.g. PrismaItemRepository).
    ratePercent: row.ratePercent.toFixed(2),
    isCompound: row.isCompound,
    isDefault: row.isDefault,
    isActive: row.isActive,
    countryCode: row.countryCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    components: row.components.map(componentToDomain),
  };
}

// sortOrder is the primary sort key (the caller's intended order, e.g.
// CGST before SGST). `id` is only a tiebreaker for legacy rows migrated
// with sortOrder defaulted to 0 — never the sole/primary sort key, since a
// random UUID doesn't correlate with insertion order at all (the bug this
// column exists to fix).
const INCLUDE_COMPONENTS = {
  components: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
};

@Injectable()
export class PrismaTaxRateRepository implements TaxRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateTaxRateInput): Promise<TaxRate> {
    const { components, ...rest } = data;
    const row = await this.prisma.taxRate.create({
      data: {
        ...rest,
        ...(components && {
          components: { create: toComponentCreateData(components) },
        }),
      },
      include: INCLUDE_COMPONENTS,
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<TaxRate | null> {
    const row = await this.prisma.taxRate.findUnique({ where: { id }, include: INCLUDE_COMPONENTS });
    return row ? toDomain(row) : null;
  }

  async update(id: string, data: UpdateTaxRateInput): Promise<TaxRate> {
    const { components, ...rest } = data;
    const row = await this.prisma.$transaction(async (tx) => {
      if (components) {
        // Replace wholesale — matches the spec's "editing only affects
        // future lines" rule, since no other table references these rows
        // yet (FR-04's POLineTaxComponent/GRNLineTaxComponent snapshot
        // their own copies once that FR exists).
        await tx.taxRateComponent.deleteMany({ where: { taxRateId: id } });
      }
      return tx.taxRate.update({
        where: { id },
        data: {
          ...rest,
          ...(components && {
            components: { create: toComponentCreateData(components) },
          }),
        },
        include: INCLUDE_COMPONENTS,
      });
    });
    return toDomain(row);
  }

  async findScoped(filters: TaxRateFilters): Promise<TaxRate[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.TaxRateWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    };

    const rows = await this.prisma.taxRate.findMany({ where, orderBy: { name: 'asc' }, include: INCLUDE_COMPONENTS });
    return rows.map(toDomain);
  }
}
