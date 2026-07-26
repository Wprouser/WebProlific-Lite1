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
  };
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

const INCLUDE_COMPONENTS = { components: { orderBy: { id: 'asc' as const } } };

@Injectable()
export class PrismaTaxRateRepository implements TaxRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateTaxRateInput): Promise<TaxRate> {
    const { components, ...rest } = data;
    const row = await this.prisma.taxRate.create({
      data: {
        ...rest,
        ...(components && {
          components: { create: components.map((c) => ({ componentName: c.componentName, componentRate: c.componentRate })) },
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
            components: {
              create: components.map((c) => ({ componentName: c.componentName, componentRate: c.componentRate })),
            },
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
