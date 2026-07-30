import { Injectable } from '@nestjs/common';
import { UnitOfMeasure as PrismaUnitOfMeasure, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UnitOfMeasure } from '../../domain/unit-of-measure.entity';
import {
  CreateUnitOfMeasureInput,
  UnitOfMeasureFilters,
  UnitOfMeasureRepository,
  UpdateUnitOfMeasureInput,
} from '../unit-of-measure.repository';

function toDomain(row: PrismaUnitOfMeasure): UnitOfMeasure {
  return {
    id: row.id,
    outletId: row.outletId,
    name: row.name,
    abbreviation: row.abbreviation,
    baseUnitId: row.baseUnitId,
    // .toFixed(6), not .toString() — matches the column's declared
    // Decimal(12,6) scale, same fixed-precision convention as every other
    // Decimal field in this codebase (see e.g. PrismaItemRepository).
    conversionFactor: row.conversionFactor?.toFixed(6) ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaUnitOfMeasureRepository implements UnitOfMeasureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUnitOfMeasureInput): Promise<UnitOfMeasure> {
    const row = await this.prisma.unitOfMeasure.create({ data });
    return toDomain(row);
  }

  async findById(id: string): Promise<UnitOfMeasure | null> {
    const row = await this.prisma.unitOfMeasure.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByNameAndOutlet(name: string, outletId: string): Promise<UnitOfMeasure | null> {
    const row = await this.prisma.unitOfMeasure.findUnique({ where: { name_outletId: { name, outletId } } });
    return row ? toDomain(row) : null;
  }

  async update(id: string, data: UpdateUnitOfMeasureInput): Promise<UnitOfMeasure> {
    const row = await this.prisma.unitOfMeasure.update({ where: { id }, data });
    return toDomain(row);
  }

  async findByBaseUnitId(baseUnitId: string): Promise<UnitOfMeasure[]> {
    const rows = await this.prisma.unitOfMeasure.findMany({ where: { baseUnitId } });
    return rows.map(toDomain);
  }

  async findScoped(filters: UnitOfMeasureFilters): Promise<UnitOfMeasure[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.UnitOfMeasureWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    };

    const rows = await this.prisma.unitOfMeasure.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(toDomain);
  }
}
