import { Injectable } from '@nestjs/common';
import { Prisma, Sale as PrismaSale } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Sale, SaleWithMenuItem, UnmappedMenuItem } from '../../domain/sale.entity';
import { CreateSaleInput, SaleFilters, SaleRepository } from '../sale.repository';

// .toFixed(3), not .toString() — Decimal.toString() drops trailing zeros
// (2.500 -> "2.5"), breaking the project's fixed-precision convention.
function toDomain(row: PrismaSale): Sale {
  return {
    id: row.id,
    outletId: row.outletId,
    menuItemId: row.menuItemId,
    quantitySold: row.quantitySold.toFixed(3),
    recipeVersionUsed: row.recipeVersionUsed,
    posReferenceId: row.posReferenceId,
    sourceType: row.sourceType as Sale['sourceType'],
    importBatchId: row.importBatchId,
    isVoid: row.isVoid,
    voidedAt: row.voidedAt,
    saleTimestamp: row.saleTimestamp,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaSaleRepository implements SaleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(input: CreateSaleInput): Promise<{ sale: Sale; created: boolean }> {
    try {
      const row = await this.prisma.sale.create({ data: input });
      return { sale: toDomain(row), created: true };
    } catch (error) {
      // P2002 = unique constraint violated. Reaching here means another
      // delivery of the same webhook won the race between our check and our
      // insert — exactly the case a read-then-write would have missed. The
      // existing row is the correct answer, so return it as "not created".
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.sale.findUnique({
          where: { posReferenceId: input.posReferenceId },
        });
        if (existing) return { sale: toDomain(existing), created: false };
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Sale | null> {
    const row = await this.prisma.sale.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByPosReferenceId(posReferenceId: string): Promise<Sale | null> {
    const row = await this.prisma.sale.findUnique({ where: { posReferenceId } });
    return row ? toDomain(row) : null;
  }

  async markVoided(id: string, voidedAt: Date): Promise<Sale> {
    const row = await this.prisma.sale.update({ where: { id }, data: { isVoid: true, voidedAt } });
    return toDomain(row);
  }

  async findScoped(filters: SaleFilters): Promise<SaleWithMenuItem[]> {
    // Same authorization-relevant guards as every other findScoped here — an
    // explicit outletId outside the caller's accessible set returns empty
    // rather than being queried anyway.
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const rows = await this.prisma.sale.findMany({
      where: {
        outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
        menuItemId: filters.menuItemId,
        sourceType: filters.sourceType,
        recipeVersionUsed: filters.unmappedOnly ? null : undefined,
        saleTimestamp:
          filters.dateFrom || filters.dateTo ? { gte: filters.dateFrom, lte: filters.dateTo } : undefined,
      },
      include: { menuItem: { select: { name: true } } },
      orderBy: { saleTimestamp: 'desc' },
    });

    return rows.map((row) => ({ ...toDomain(row), menuItemName: row.menuItem.name }));
  }

  async findUnmappedMenuItems(accessibleOutletIds: string[], outletId?: string): Promise<UnmappedMenuItem[]> {
    if (accessibleOutletIds.length === 0) return [];
    if (outletId && !accessibleOutletIds.includes(outletId)) return [];

    const grouped = await this.prisma.sale.groupBy({
      by: ['menuItemId', 'outletId'],
      where: {
        outletId: outletId ?? { in: accessibleOutletIds },
        // Voided sales deducted nothing and were reversed; they shouldn't
        // keep an item on a worklist about *future* deductions.
        recipeVersionUsed: null,
        isVoid: false,
      },
      _count: { _all: true },
      _sum: { quantitySold: true },
      _max: { saleTimestamp: true },
    });
    if (grouped.length === 0) return [];

    // groupBy can't include a relation, so names are fetched in one extra
    // query rather than one per group.
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: grouped.map((group) => group.menuItemId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem.name]));

    return grouped
      .map((group) => ({
        menuItemId: group.menuItemId,
        menuItemName: nameById.get(group.menuItemId) ?? '',
        outletId: group.outletId,
        saleCount: group._count._all,
        totalQuantitySold: (group._sum.quantitySold ?? new Prisma.Decimal(0)).toFixed(3),
        lastSoldAt: group._max.saleTimestamp!,
      }))
      .sort((a, b) => b.lastSoldAt.getTime() - a.lastSoldAt.getTime());
  }
}
