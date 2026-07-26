import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoiceScansService } from '../services/invoice-scans.service';
import { UploadInvoiceScanDto } from '../dto/upload-invoice-scan.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

const MAX_SCAN_BYTES = 10 * 1024 * 1024;

/** AI-04 / FR-04 Flow 3 — Scan Invoice. Deliberately its own resource
 * (`/invoice-scans`), not `/grn/:id/scan-invoice` as the spec's endpoint
 * table literally shows — see InvoiceScan's schema comment for why: GRN
 * has no draft state, and creating one is already a one-shot financial
 * action, so the pre-review scan can't be modeled as an in-progress GRN
 * row. The real GRN is only ever created afterward, via the existing
 * POST /grn/direct or POST /purchase-orders/:id/grn, once the human has
 * reviewed and confirmed the extracted data. */
@Controller('invoice-scans')
export class InvoiceScansController {
  constructor(
    private readonly invoiceScansService: InvoiceScansService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Body() dto: UploadInvoiceScanDto,
    @Req() request: RequestWithAccess,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_SCAN_BYTES }),
          new FileTypeValidator({
            fileType: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const scan = await this.invoiceScansService.upload(request, dto.outletId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname,
    });
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_INVOICE_SCAN',
      entityType: 'InvoiceScan',
      entityId: scan.id,
      outletId: scan.outletId,
      after: scan,
    });
    return scan;
  }

  @Get(':id')
  getStatus(@Param('id') id: string, @Req() request: RequestWithAccess) {
    return this.invoiceScansService.getStatus(request, id);
  }
}
