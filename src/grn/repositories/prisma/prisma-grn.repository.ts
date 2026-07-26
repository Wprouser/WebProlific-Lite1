import { Inject, Injectable } from '@nestjs/common';
import {
  GRN as PrismaGRN,
  GRNLine as PrismaGRNLine,
  GRNLineTaxComponent as PrismaGRNLineTaxComponent,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GRN, GRNLine, GRNLineTaxComponent } from '../../domain/grn.entity';
import { InvoiceScanStatus } from '../../constants/enums';
import { CreateGrnInput, CreateGrnLineInput, GrnFilters, GrnRepository, UpdateEmailSentInput } from '../grn.repository';
import { applyStockTransaction } from '../../../stock-transactions/lib/apply-stock-transaction';
import { recordSupplierPriceHistory } from '../../../suppliers/lib/record-supplier-price-history';
import { PURCHASE_ORDER_REPOSITORY } from '../../../purchase-orders/repositories/tokens';
import { PurchaseOrderRepository } from '../../../purchase-orders/repositories/purchase-order.repository';

type PrismaGRNLineTaxComponentRow = PrismaGRNLineTaxComponent;
type PrismaGRNLineRow = PrismaGRNLine & { taxComponents: PrismaGRNLineTaxComponentRow[] };
type PrismaGRNRow = PrismaGRN & { lines: PrismaGRNLineRow[] };

function componentToDomain(row: PrismaGRNLineTaxComponentRow): GRNLineTaxComponent {
  return {
    id: row.id,
    grnLineId: row.grnLineId,
    componentName: row.componentName,
    componentRate: row.componentRate.toFixed(2),
    componentAmount: row.componentAmount.toFixed(2),
    sortOrder: row.sortOrder,
  };
}

function lineToDomain(row: PrismaGRNLineRow): GRNLine {
  return {
    id: row.id,
    grnId: row.grnId,
    itemId: row.itemId,
    orderedQty: row.orderedQty ? row.orderedQty.toFixed(3) : null,
    receivedQty: row.receivedQty.toFixed(3),
    actualPrice: row.actualPrice.toFixed(2),
    taxRateId: row.taxRateId,
    taxRate: row.taxRate.toFixed(2),
    lineSubtotal: row.lineSubtotal.toFixed(2),
    lineTaxAmount: row.lineTaxAmount.toFixed(2),
    lineTotal: row.lineTotal.toFixed(2),
    taxComponents: row.taxComponents.map(componentToDomain),
  };
}

function toDomain(row: PrismaGRNRow): GRN {
  return {
    id: row.id,
    outletId: row.outletId,
    purchaseOrderId: row.purchaseOrderId,
    supplierId: row.supplierId,
    receivedById: row.receivedById,
    receivedAt: row.receivedAt,
    currencyCode: row.currencyCode,
    exchangeRateToBase: row.exchangeRateToBase.toFixed(6),
    isTaxInclusive: row.isTaxInclusive,
    discountAmount: row.discountAmount.toFixed(2),
    otherChargesAmount: row.otherChargesAmount.toFixed(2),
    subtotal: row.subtotal.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalValue: row.totalValue.toFixed(2),
    invoiceNumber: row.invoiceNumber,
    invoiceScanUrl: row.invoiceScanUrl,
    invoiceScanStatus: row.invoiceScanStatus as InvoiceScanStatus | null,
    varianceFlagged: row.varianceFlagged,
    lines: row.lines.map(lineToDomain),
    lastEmailedAt: row.lastEmailedAt,
    lastEmailedTo: row.lastEmailedTo,
  };
}

const INCLUDE_LINES = {
  lines: { include: { taxComponents: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } } },
};

function toLineCreateData(lines: CreateGrnLineInput[]) {
  return lines.map((line) => ({
    itemId: line.itemId,
    orderedQty: line.orderedQty,
    receivedQty: line.receivedQty,
    actualPrice: line.actualPrice,
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

/**
 * GRN finalization touches four different modules' tables — GRN/GRNLine
 * (its own), StockTransaction + Item.currentStock (via the shared
 * `applyStockTransaction` plain function), SupplierPriceHistory (via the
 * shared `recordSupplierPriceHistory` plain function), and — when linked to
 * a PO — POLine.receivedQty + PurchaseOrder.status (via
 * `PurchaseOrderRepository.applyGrnReceipt`, injected here directly since
 * PurchaseOrdersModule exports its token; there's no cycle since
 * PurchaseOrdersModule never imports GrnModule back). All of it must commit
 * or fail as one unit (spec: "every finalized GRN line results in exactly
 * one StockTransaction and one SupplierPriceHistory row"), so it all runs
 * inside this repository's own `prisma.$transaction` — a deliberate, narrow
 * exception to "each repository only touches its own module's Prisma
 * models," same precedent as PrismaItemRepository's opening-stock path.
 */
@Injectable()
export class PrismaGrnRepository implements GrnRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PURCHASE_ORDER_REPOSITORY) private readonly poRepository: PurchaseOrderRepository,
  ) {}

  async create(data: CreateGrnInput): Promise<GRN> {
    const row = await this.prisma.$transaction(
      async (tx) => {
        const { lines, ...rest } = data;
        const grn = await tx.gRN.create({
          data: { ...rest, lines: { create: toLineCreateData(lines) } },
          include: INCLUDE_LINES,
        });

        for (const line of grn.lines) {
          const item = await tx.item.findUniqueOrThrow({ where: { id: line.itemId } });
          const outcome = await applyStockTransaction(tx, {
            outletId: data.outletId,
            itemId: line.itemId,
            type: 'PURCHASE_IN',
            quantity: line.receivedQty.toFixed(3),
            currentStock: item.currentStock,
            referenceType: 'GRN',
            referenceId: grn.id,
            reasonCode: null,
            performedById: data.receivedById,
            allowNegativeBalance: false,
          });
          if (!outcome.ok) {
            // Unreachable: PURCHASE_IN always adds to currentStock, so it
            // can never go negative — thrown so a future change to that
            // invariant fails loudly instead of silently dropping stock.
            throw new Error('PURCHASE_IN balance computation went negative unexpectedly');
          }

          await recordSupplierPriceHistory(tx, {
            supplierId: data.supplierId,
            itemId: line.itemId,
            price: line.actualPrice.toFixed(2),
            currencyCode: data.currencyCode,
            exchangeRateToBase: data.exchangeRateToBase,
            source: 'GRN',
          });
        }

        if (data.purchaseOrderId) {
          const receipts = lines
            .filter((l) => l.poLineId)
            .map((l) => ({ poLineId: l.poLineId!, receivedQty: l.receivedQty }));
          await this.poRepository.applyGrnReceipt(tx, data.purchaseOrderId, receipts);
        }

        return grn;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toDomain(row);
  }

  async findById(id: string): Promise<GRN | null> {
    const row = await this.prisma.gRN.findUnique({ where: { id }, include: INCLUDE_LINES });
    return row ? toDomain(row) : null;
  }

  async findScoped(filters: GrnFilters): Promise<GRN[]> {
    if (filters.accessibleOutletIds.length === 0) return [];
    if (filters.outletId && !filters.accessibleOutletIds.includes(filters.outletId)) return [];

    const where: Prisma.GRNWhereInput = {
      outletId: filters.outletId ?? { in: filters.accessibleOutletIds },
      ...(filters.supplierId && { supplierId: filters.supplierId }),
      ...(filters.purchaseOrderId && { purchaseOrderId: filters.purchaseOrderId }),
      ...((filters.dateFrom || filters.dateTo) && {
        receivedAt: { gte: filters.dateFrom, lte: filters.dateTo },
      }),
    };

    const rows = await this.prisma.gRN.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      include: INCLUDE_LINES,
    });
    return rows.map(toDomain);
  }

  async updateEmailSent(id: string, data: UpdateEmailSentInput): Promise<GRN> {
    const row = await this.prisma.gRN.update({ where: { id }, data, include: INCLUDE_LINES });
    return toDomain(row);
  }
}
