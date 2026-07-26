import { Injectable } from '@nestjs/common';
import {
  PurchaseOrder as PrismaPurchaseOrder,
  POLine as PrismaPOLine,
  POLineTaxComponent as PrismaPOLineTaxComponent,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PurchaseOrder, POLine, POLineTaxComponent } from '../../domain/purchase-order.entity';
import { POStatus } from '../../constants/enums';
import {
  ApplyGrnReceiptLineInput,
  CreatePOLineInput,
  CreatePurchaseOrderInput,
  POFilters,
  PurchaseOrderRepository,
  UpdateEmailSentInput,
  UpdatePurchaseOrderInput,
  UpdateStatusInput,
} from '../purchase-order.repository';

type PrismaPOLineTaxComponentRow = PrismaPOLineTaxComponent;
type PrismaPOLineRow = PrismaPOLine & { taxComponents: PrismaPOLineTaxComponentRow[] };
type PrismaPurchaseOrderRow = PrismaPurchaseOrder & { lines: PrismaPOLineRow[] };

function componentToDomain(row: PrismaPOLineTaxComponentRow): POLineTaxComponent {
  return {
    id: row.id,
    poLineId: row.poLineId,
    componentName: row.componentName,
    componentRate: row.componentRate.toFixed(2),
    componentAmount: row.componentAmount.toFixed(2),
    sortOrder: row.sortOrder,
  };
}

function lineToDomain(row: PrismaPOLineRow): POLine {
  return {
    id: row.id,
    purchaseOrderId: row.purchaseOrderId,
    itemId: row.itemId,
    orderedQty: row.orderedQty.toFixed(3),
    expectedPrice: row.expectedPrice.toFixed(2),
    taxRateId: row.taxRateId,
    taxRate: row.taxRate.toFixed(2),
    lineSubtotal: row.lineSubtotal.toFixed(2),
    lineTaxAmount: row.lineTaxAmount.toFixed(2),
    lineTotal: row.lineTotal.toFixed(2),
    receivedQty: row.receivedQty.toFixed(3),
    taxComponents: row.taxComponents.map(componentToDomain),
  };
}

function toDomain(row: PrismaPurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    outletId: row.outletId,
    supplierId: row.supplierId,
    status: row.status as POStatus,
    expectedDeliveryDate: row.expectedDeliveryDate,
    createdById: row.createdById,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    currencyCode: row.currencyCode,
    exchangeRateToBase: row.exchangeRateToBase.toFixed(6),
    isTaxInclusive: row.isTaxInclusive,
    discountAmount: row.discountAmount.toFixed(2),
    otherChargesAmount: row.otherChargesAmount.toFixed(2),
    subtotal: row.subtotal.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalValue: row.totalValue.toFixed(2),
    lines: row.lines.map(lineToDomain),
    createdAt: row.createdAt,
    lastEmailedAt: row.lastEmailedAt,
    lastEmailedTo: row.lastEmailedTo,
  };
}

const INCLUDE_LINES = {
  lines: { include: { taxComponents: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } } },
};

function toLineCreateData(lines: CreatePOLineInput[]) {
  return lines.map((line) => ({
    itemId: line.itemId,
    orderedQty: line.orderedQty,
    expectedPrice: line.expectedPrice,
    taxRateId: line.taxRateId,
    taxRate: line.taxRate,
    lineSubtotal: line.lineSubtotal,
    lineTaxAmount: line.lineTaxAmount,
    lineTotal: line.lineTotal,
    taxComponents: {
      create: line.taxComponents.map((c, index) => ({
        componentName: c.componentName,
        componentRate: c.componentRate,
        componentAmount: c.componentAmount,
        sortOrder: index,
      })),
    },
  }));
}

@Injectable()
export class PrismaPurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    const { lines, ...rest } = data;
    const row = await this.prisma.purchaseOrder.create({
      data: { ...rest, lines: { create: toLineCreateData(lines) } },
      include: INCLUDE_LINES,
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    const row = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: INCLUDE_LINES });
    return row ? toDomain(row) : null;
  }

  async update(id: string, data: UpdatePurchaseOrderInput): Promise<PurchaseOrder> {
    const { lines, ...rest } = data;
    const row = await this.prisma.$transaction(async (tx) => {
      if (lines) {
        // Replace wholesale (delete + recreate) — matches
        // PrismaTaxRateRepository's own precedent for the same "editing
        // only affects a not-yet-finalized record" case. FK ordering:
        // components before lines (SQL Server FK is ON DELETE NO ACTION).
        const existingLineIds = (
          await tx.pOLine.findMany({ where: { purchaseOrderId: id }, select: { id: true } })
        ).map((l) => l.id);
        if (existingLineIds.length > 0) {
          await tx.pOLineTaxComponent.deleteMany({ where: { poLineId: { in: existingLineIds } } });
          await tx.pOLine.deleteMany({ where: { purchaseOrderId: id } });
        }
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: { ...rest, ...(lines && { lines: { create: toLineCreateData(lines) } }) },
        include: INCLUDE_LINES,
      });
    });
    return toDomain(row);
  }

  async updateStatus(id: string, data: UpdateStatusInput): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.update({
      where: { id },
      data,
      include: INCLUDE_LINES,
    });
    return toDomain(row);
  }

  async findScoped(filters: POFilters): Promise<PurchaseOrder[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.PurchaseOrderWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.status && { status: filters.status }),
      ...(filters.supplierId && { supplierId: filters.supplierId }),
      ...((filters.dateFrom || filters.dateTo) && {
        createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      }),
    };

    const rows = await this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: INCLUDE_LINES,
    });
    return rows.map(toDomain);
  }

  async applyGrnReceipt(
    tx: Prisma.TransactionClient,
    poId: string,
    lines: ApplyGrnReceiptLineInput[],
  ): Promise<void> {
    for (const line of lines) {
      const poLine = await tx.pOLine.findUniqueOrThrow({ where: { id: line.poLineId } });
      const newReceivedQty = poLine.receivedQty.plus(new Prisma.Decimal(line.receivedQty));
      await tx.pOLine.update({ where: { id: line.poLineId }, data: { receivedQty: newReceivedQty.toFixed(3) } });
    }

    const allLines = await tx.pOLine.findMany({ where: { purchaseOrderId: poId } });
    const allFullyReceived = allLines.every((l) => l.receivedQty.gte(l.orderedQty));
    const anyReceived = allLines.some((l) => l.receivedQty.greaterThan(0));

    if (allFullyReceived) {
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'FULLY_RECEIVED' } });
    } else if (anyReceived) {
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'PARTIALLY_RECEIVED' } });
    }
  }

  async updateEmailSent(id: string, data: UpdateEmailSentInput): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.update({ where: { id }, data, include: INCLUDE_LINES });
    return toDomain(row);
  }
}
