import { Injectable } from '@nestjs/common';
import { Supplier as PrismaSupplier, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Supplier } from '../../domain/supplier.entity';
import {
  CreateSupplierInput,
  SupplierFilters,
  SupplierRepository,
  UpdateSupplierInput,
} from '../supplier.repository';

function toDomain(row: PrismaSupplier): Supplier {
  return { ...row };
}

@Injectable()
export class PrismaSupplierRepository implements SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateSupplierInput): Promise<Supplier> {
    const row = await this.prisma.supplier.create({ data });
    return toDomain(row);
  }

  async findById(id: string): Promise<Supplier | null> {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async update(id: string, data: UpdateSupplierInput): Promise<Supplier> {
    const row = await this.prisma.supplier.update({ where: { id }, data });
    return toDomain(row);
  }

  async findScoped(filters: SupplierFilters): Promise<Supplier[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.SupplierWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search } },
          { supplierCode: { contains: filters.search } },
        ],
      }),
    };

    const rows = await this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(toDomain);
  }
}
