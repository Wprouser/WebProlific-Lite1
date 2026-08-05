import { Injectable } from '@nestjs/common';
import { Alert as PrismaAlert } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Alert, AlertSummary, AlertWithItem } from '../../domain/alert.entity';
import {
  AlertFilters,
  AlertRepository,
  CreateAlertInput,
  ExpiryCandidate,
} from '../alert.repository';
import { AlertStatus, AlertType, LIVE_ALERT_STATUSES, STOCK_ALERT_TYPES } from '../../constants/enums';

function toDomain(row: PrismaAlert): Alert {
  return {
    id: row.id,
    outletId: row.outletId,
    itemId: row.itemId,
    type: row.type as AlertType,
    status: row.status as AlertStatus,
    message: row.message,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    resolvedAt: row.resolvedAt,
  };
}

@Injectable()
export class PrismaAlertRepository implements AlertRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAlertInput): Promise<Alert> {
    return toDomain(await this.prisma.alert.create({ data: input }));
  }

  async findById(id: string): Promise<Alert | null> {
    const row = await this.prisma.alert.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findScoped(filters: AlertFilters): Promise<AlertWithItem[]> {
    // Same authorization-relevant guards as every other findScoped here — an
    // explicit outletId outside the caller's accessible set returns empty
    // rather than being queried anyway.
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const rows = await this.prisma.alert.findMany({
      where: {
        outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
        status: filters.status,
        type: filters.type,
      },
      include: { item: { select: { name: true } } },
      // Newest first: an alert list is a worklist, and the thing that just
      // happened is the thing most likely to still be actionable.
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({ ...toDomain(row), itemName: row.item?.name ?? null }));
  }

  async findLiveAlert(itemId: string, type: AlertType, since: Date): Promise<Alert | null> {
    const row = await this.prisma.alert.findFirst({
      where: {
        itemId,
        type,
        status: { in: LIVE_ALERT_STATUSES },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async updateStatus(
    id: string,
    status: AlertStatus,
    timestamps: { acknowledgedAt?: Date; resolvedAt?: Date },
  ): Promise<Alert> {
    const row = await this.prisma.alert.update({
      where: { id },
      data: { status, ...timestamps },
    });
    return toDomain(row);
  }

  async resolveLiveStockAlerts(itemId: string, resolvedAt: Date): Promise<number> {
    // updateMany, not read-then-write: this runs on every stock change for a
    // healthy item, and the count is all the caller needs.
    const result = await this.prisma.alert.updateMany({
      where: { itemId, type: { in: STOCK_ALERT_TYPES }, status: { in: LIVE_ALERT_STATUSES } },
      data: { status: 'RESOLVED', resolvedAt },
    });
    return result.count;
  }

  async findExpiryCandidates(): Promise<ExpiryCandidate[]> {
    const items = await this.prisma.item.findMany({
      where: {
        isActive: true,
        shelfLifeDays: { not: null },
        // Nothing on hand can't spoil. Also keeps the nightly scan off the
        // long tail of items that are simply out of stock.
        currentStock: { gt: 0 },
      },
      select: { id: true, outletId: true, name: true, shelfLifeDays: true, currentStock: true },
    });
    if (items.length === 0) return [];

    // One grouped query for the last receipt of every candidate, rather than
    // one query per item — a nightly job over a full catalogue would
    // otherwise be an N+1 storm.
    const lastReceipts = await this.prisma.stockTransaction.groupBy({
      by: ['itemId'],
      where: { itemId: { in: items.map((item) => item.id) }, type: 'PURCHASE_IN' },
      _max: { createdAt: true },
    });
    const lastByItem = new Map(lastReceipts.map((row) => [row.itemId, row._max.createdAt]));

    return items.map((item) => ({
      itemId: item.id,
      outletId: item.outletId,
      itemName: item.name,
      shelfLifeDays: item.shelfLifeDays!,
      currentStock: item.currentStock.toFixed(3),
      lastPurchaseInAt: lastByItem.get(item.id) ?? null,
    }));
  }

  async summarize(accessibleOutletIds: string[], outletId?: string): Promise<AlertSummary> {
    const empty: AlertSummary = {
      lowStock: 0,
      expiry: 0,
      unacknowledged: 0,
      poApprovals: 0,
      grnVariance: 0,
    };
    if (accessibleOutletIds.length === 0) return empty;
    if (outletId && !accessibleOutletIds.includes(outletId)) return empty;

    const outletFilter = outletId ?? { in: accessibleOutletIds };
    const live = { in: LIVE_ALERT_STATUSES };

    const [lowStock, expiry, unacknowledged, poApprovals, grnVariance] = await Promise.all([
      this.prisma.alert.count({
        where: { outletId: outletFilter, status: live, type: { in: STOCK_ALERT_TYPES } },
      }),
      this.prisma.alert.count({
        where: { outletId: outletFilter, status: live, type: 'EXPIRY_WARNING' },
      }),
      // Strictly OPEN, not live: this badge is "nobody has looked at these
      // yet", which is what acknowledging is for.
      this.prisma.alert.count({ where: { outletId: outletFilter, status: 'OPEN' } }),
      // FR-04 data, always real, never previously exposed to the bar.
      this.prisma.purchaseOrder.count({
        where: { outletId: outletFilter, status: 'PENDING_APPROVAL' },
      }),
      this.prisma.gRN.count({ where: { outletId: outletFilter, varianceFlagged: true } }),
    ]);

    return { lowStock, expiry, unacknowledged, poApprovals, grnVariance };
  }
}
