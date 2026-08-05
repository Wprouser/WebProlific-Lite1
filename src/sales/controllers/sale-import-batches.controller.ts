import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SaleImportService } from '../services/sale-import.service';
import { CreateImportBatchDto } from '../dto/create-import-batch.dto';
import { AssignImportRowDto } from '../dto/assign-import-row.dto';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * FR-06 Model 2 — daily batch import. Three steps, three endpoints, and the
 * split between them is the feature: upload stages, review projects, and only
 * `run` moves stock.
 */
@Controller('sales/import-batches')
export class SaleImportBatchesController {
  constructor(
    private readonly saleImportService: SaleImportService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Step 1 — Upload. Creates a STAGED batch and deducts nothing. */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Req() request: RequestWithAccess,
    @Body() dto: CreateImportBatchDto,
    @UploadedFile(
      new ParseFilePipe({
        // Size only — no FileTypeValidator. A CSV exported by a POS arrives
        // as text/csv, text/plain, application/octet-stream or with no type
        // at all depending on the browser and the file's extension, so
        // gating on the declared MIME type would reject valid uploads. The
        // parser itself is the real check: it either finds a usable header
        // row or returns a 400 explaining what the file needs.
        validators: [new MaxFileSizeValidator({ maxSize: MAX_IMPORT_BYTES })],
      }),
    )
    file: Express.Multer.File,
  ) {
    const result = await this.saleImportService.stageUpload(
      request,
      dto.outletId,
      { buffer: file.buffer, originalName: file.originalname },
      dto.dateFormat,
    );
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'CREATE_SALE_IMPORT_BATCH',
      entityType: 'SaleImportBatch',
      entityId: result.batch.id,
      outletId: dto.outletId,
      after: result.batch,
    });
    return result;
  }

  @Get()
  listBatches(@Req() request: RequestWithAccess, @Query('outletId') outletId?: string) {
    return this.saleImportService.listBatches(request, outletId);
  }

  /** Step 2 — Review: rows, match state, and the projected ingredient impact. */
  @Get(':id')
  review(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.saleImportService.review(request, id);
  }

  /** Correct one row's mapping in place — no re-upload. */
  @Patch(':id/rows/:rowId')
  assignRow(
    @Req() request: RequestWithAccess,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: AssignImportRowDto,
  ) {
    return this.saleImportService.assignRow(request, id, rowId, dto.menuItemId);
  }

  /** Step 3 — "Run BOM". The only endpoint in this flow that moves stock. */
  @Post(':id/run')
  run(@Req() request: RequestWithAccess, @Param('id') id: string) {
    return this.saleImportService.run(request, id);
  }
}
