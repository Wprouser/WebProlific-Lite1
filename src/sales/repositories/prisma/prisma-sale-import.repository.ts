import { Injectable } from '@nestjs/common';
import {
  SaleImportBatch as PrismaSaleImportBatch,
  SaleImportRow as PrismaSaleImportRow,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaleImportBatch, SaleImportRow, SaleImportRowWithMenuItem } from '../../domain/sale.entity';
import {
  CreateSaleImportBatchInput,
  SaleImportRepository,
} from '../sale-import.repository';
import { SaleImportStatus } from '../../constants/enums';

function batchToDomain(row: PrismaSaleImportBatch): SaleImportBatch {
  return {
    id: row.id,
    outletId: row.outletId,
    fileName: row.fileName,
    importedById: row.importedById,
    status: row.status as SaleImportStatus,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  };
}

function rowToDomain(row: PrismaSaleImportRow): SaleImportRow {
  return {
    id: row.id,
    batchId: row.batchId,
    rowNumber: row.rowNumber,
    rawMenuItemName: row.rawMenuItemName,
    rawSku: row.rawSku,
    quantitySold: row.quantitySold.toFixed(3),
    saleDate: row.saleDate,
    posReferenceRaw: row.posReferenceRaw,
    matchedMenuItemId: row.matchedMenuItemId,
    matchStatus: row.matchStatus as SaleImportRow['matchStatus'],
    saleId: row.saleId,
    skipReason: row.skipReason,
  };
}

@Injectable()
export class PrismaSaleImportRepository implements SaleImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithRows(input: CreateSaleImportBatchInput): Promise<SaleImportBatch> {
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.saleImportBatch.create({
        data: {
          outletId: input.outletId,
          fileName: input.fileName,
          importedById: input.importedById,
          totalRows: input.rows.length,
        },
      });
      await tx.saleImportRow.createMany({
        data: input.rows.map((row) => ({ ...row, batchId: created.id })),
      });
      return created;
    });
    return batchToDomain(batch);
  }

  async findBatchById(id: string): Promise<SaleImportBatch | null> {
    const row = await this.prisma.saleImportBatch.findUnique({ where: { id } });
    return row ? batchToDomain(row) : null;
  }

  async findBatchesForOutlets(accessibleOutletIds: string[], outletId?: string): Promise<SaleImportBatch[]> {
    if (accessibleOutletIds.length === 0) return [];
    if (outletId && !accessibleOutletIds.includes(outletId)) return [];

    const rows = await this.prisma.saleImportBatch.findMany({
      where: { outletId: outletId ?? { in: accessibleOutletIds } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(batchToDomain);
  }

  async findRows(batchId: string): Promise<SaleImportRowWithMenuItem[]> {
    const rows = await this.prisma.saleImportRow.findMany({
      where: { batchId },
      include: { matchedMenuItem: { select: { name: true } } },
      orderBy: { rowNumber: 'asc' },
    });
    return rows.map((row) => ({
      ...rowToDomain(row),
      matchedMenuItemName: row.matchedMenuItem?.name ?? null,
    }));
  }

  async findRowById(rowId: string): Promise<SaleImportRow | null> {
    const row = await this.prisma.saleImportRow.findUnique({ where: { id: rowId } });
    return row ? rowToDomain(row) : null;
  }

  async assignRowMenuItem(rowId: string, menuItemId: string): Promise<SaleImportRow> {
    const row = await this.prisma.saleImportRow.update({
      where: { id: rowId },
      // MANUAL rather than MATCHED, deliberately: the review screen should
      // be able to show which mappings a human chose versus which the fuzzy
      // matcher guessed, since only the former is known-good.
      data: { matchedMenuItemId: menuItemId, matchStatus: 'MANUAL', skipReason: null },
    });
    return rowToDomain(row);
  }

  async markRowProcessed(
    rowId: string,
    result: { saleId: string | null; skipReason: string | null },
  ): Promise<void> {
    await this.prisma.saleImportRow.update({
      where: { id: rowId },
      data: { saleId: result.saleId, skipReason: result.skipReason },
    });
  }

  async updateBatchStatus(
    id: string,
    update: { status: SaleImportStatus; processedRows?: number; processedAt?: Date },
  ): Promise<SaleImportBatch> {
    const row = await this.prisma.saleImportBatch.update({
      where: { id },
      data: {
        status: update.status,
        processedRows: update.processedRows,
        processedAt: update.processedAt,
      },
    });
    return batchToDomain(row);
  }
}
