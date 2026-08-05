import { Injectable } from '@nestjs/common';
import { Prisma, StockTransaction as PrismaStockTransaction, Item as PrismaItem } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockTransaction } from '../../domain/stock-transaction.entity';
import {
  CreateStockTransactionInput,
  CreateStockTransactionResult,
  StockTransactionFilters,
  StockTransactionRepository,
  UpdatedItemStockSnapshot,
} from '../stock-transaction.repository';
import { applyStockTransaction } from '../../lib/apply-stock-transaction';

// .toFixed(n), not .toString() — Decimal.toString() drops trailing zeros
// (85.50 -> "85.5"), breaking the project's fixed-precision convention.
function toDomain(row: PrismaStockTransaction): StockTransaction {
  return {
    id: row.id,
    outletId: row.outletId,
    itemId: row.itemId,
    type: row.type as StockTransaction['type'],
    quantity: row.quantity.toFixed(3),
    balanceAfter: row.balanceAfter.toFixed(3),
    referenceType: row.referenceType as StockTransaction['referenceType'],
    referenceId: row.referenceId,
    reasonCode: row.reasonCode as StockTransaction['reasonCode'],
    photoUrl: row.photoUrl,
    performedById: row.performedById,
    createdAt: row.createdAt,
  };
}

function snapshotOf(item: PrismaItem): UpdatedItemStockSnapshot {
  return {
    id: item.id,
    outletId: item.outletId,
    minStock: item.minStock.toFixed(3),
    currentStock: item.currentStock.toFixed(3),
  };
}

@Injectable()
export class PrismaStockTransactionRepository implements StockTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithBalanceUpdate(input: CreateStockTransactionInput): Promise<CreateStockTransactionResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // The read below, under Serializable isolation, is what makes this
        // safe for concurrent stock-out requests on the same item — SQL
        // Server detects the conflicting read/write set and aborts one of
        // two racing transactions rather than letting both compute a
        // balance from the same stale currentStock. Deliberately not a raw
        // `WITH (UPDLOCK, ROWLOCK)` hint — that would tie this repository
        // to SQL Server specifically, against the Repository Pattern's
        // whole point of keeping the DB swappable (see CLAUDE.md).
        const item = await tx.item.findUniqueOrThrow({ where: { id: input.itemId } });

        const outcome = await applyStockTransaction(tx, {
          outletId: input.outletId,
          itemId: input.itemId,
          type: input.type,
          quantity: input.quantity,
          currentStock: item.currentStock,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          reasonCode: input.reasonCode,
          performedById: input.performedById,
          allowNegativeBalance: input.allowNegativeBalance,
        });

        if (!outcome.ok) {
          return { ok: false, reason: outcome.reason, item: snapshotOf(item) };
        }

        return {
          ok: true,
          transaction: toDomain(outcome.transaction),
          item: snapshotOf({ ...item, currentStock: outcome.balanceAfter }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findById(id: string): Promise<StockTransaction | null> {
    const row = await this.prisma.stockTransaction.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findScoped(filters: StockTransactionFilters): Promise<StockTransaction[]> {
    // Same authorization-relevant guards as PrismaItemRepository.findScoped
    // — an explicit outletId filter outside the caller's accessible set
    // must return empty, not silently query it anyway.
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
        itemId: filters.itemId,
        type: filters.type,
        createdAt:
          filters.dateFrom || filters.dateTo
            ? { gte: filters.dateFrom, lte: filters.dateTo }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async findByReference(referenceType: string, referenceId: string): Promise<StockTransaction[]> {
    const rows = await this.prisma.stockTransaction.findMany({
      where: { referenceType, referenceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async existsForOutlet(outletId: string): Promise<boolean> {
    const row = await this.prisma.stockTransaction.findFirst({
      where: { outletId },
      select: { id: true },
    });
    return row !== null;
  }
}
