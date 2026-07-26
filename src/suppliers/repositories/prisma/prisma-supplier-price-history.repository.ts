import { Injectable } from '@nestjs/common';
import { SupplierPriceHistory as PrismaSupplierPriceHistory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SupplierPriceHistory } from '../../domain/supplier-price-history.entity';
import {
  SupplierPriceHistoryFilters,
  SupplierPriceHistoryRepository,
} from '../supplier-price-history.repository';

function toDomain(row: PrismaSupplierPriceHistory): SupplierPriceHistory {
  return {
    id: row.id,
    supplierId: row.supplierId,
    itemId: row.itemId,
    // .toFixed(2), not .toString() — matches the project's fixed-precision
    // convention for Decimal fields.
    price: row.price.toFixed(2),
    currencyCode: row.currencyCode,
    priceInBaseCurrency: row.priceInBaseCurrency === null ? null : row.priceInBaseCurrency.toFixed(2),
    recordedAt: row.recordedAt,
    source: row.source as SupplierPriceHistory['source'],
  };
}

@Injectable()
export class PrismaSupplierPriceHistoryRepository implements SupplierPriceHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findScoped(filters: SupplierPriceHistoryFilters): Promise<SupplierPriceHistory[]> {
    const rows = await this.prisma.supplierPriceHistory.findMany({
      where: { supplierId: filters.supplierId, ...(filters.itemId && { itemId: filters.itemId }) },
      orderBy: { recordedAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}
