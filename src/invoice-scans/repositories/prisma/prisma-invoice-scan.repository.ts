import { Injectable } from '@nestjs/common';
import { InvoiceScan as PrismaInvoiceScan } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExtractedInvoiceData, InvoiceScan } from '../../domain/invoice-scan.entity';
import { InvoiceScanProcessingStatus } from '../../constants/enums';
import {
  CreateInvoiceScanInput,
  InvoiceScanRepository,
  UpdateInvoiceScanResultInput,
} from '../invoice-scan.repository';

function toDomain(row: PrismaInvoiceScan): InvoiceScan {
  return {
    id: row.id,
    outletId: row.outletId,
    fileUrl: row.fileUrl,
    status: row.status as InvoiceScanProcessingStatus,
    extractedData: row.extractedData ? (JSON.parse(row.extractedData) as ExtractedInvoiceData) : null,
    failureReason: row.failureReason,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaInvoiceScanRepository implements InvoiceScanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateInvoiceScanInput): Promise<InvoiceScan> {
    const row = await this.prisma.invoiceScan.create({ data });
    return toDomain(row);
  }

  async findById(id: string): Promise<InvoiceScan | null> {
    const row = await this.prisma.invoiceScan.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async updateResult(id: string, data: UpdateInvoiceScanResultInput): Promise<InvoiceScan> {
    const row = await this.prisma.invoiceScan.update({
      where: { id },
      data: {
        status: data.status,
        extractedData: data.extractedData ? JSON.stringify(data.extractedData) : undefined,
        failureReason: data.failureReason,
      },
    });
    return toDomain(row);
  }
}
