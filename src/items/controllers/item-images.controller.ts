import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ItemImagesService } from '../services/item-images.service';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { AuditLogService } from '../../rbac/services/audit-log.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

@Controller('items/:itemId/images')
export class ItemImagesController {
  constructor(
    private readonly itemImagesService: ItemImagesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  list(@Param('itemId') itemId: string, @Req() request: RequestWithAccess) {
    return this.itemImagesService.list(request, itemId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('itemId') itemId: string,
    @Req() request: RequestWithAccess,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          // skipMagicNumbersValidation: true — Nest's default magic-number
          // sniffing dynamically imports the ESM-only `file-type` package,
          // which throws ("dynamic import callback was invoked without
          // --experimental-vm-modules") under this project's Jest/ts-jest
          // setup, and that flag is a much bigger, riskier project-wide
          // change than this endpoint's threat model justifies (an
          // authenticated, role-gated upload storing a static asset, not
          // executing one). Falls back to declared Content-Type matching,
          // same as the mimetype check most upload endpoints rely on.
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/, skipMagicNumbersValidation: true }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const image = await this.itemImagesService.upload(request, itemId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalName: file.originalname,
    });
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'UPLOAD_ITEM_IMAGE',
      entityType: 'Item',
      entityId: itemId,
      after: image,
    });
    return image;
  }

  @Patch(':imageId/primary')
  async setPrimary(
    @Param('itemId') itemId: string,
    @Param('imageId') imageId: string,
    @Req() request: RequestWithAccess,
  ) {
    const image = await this.itemImagesService.setPrimary(request, itemId, imageId);
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'SET_PRIMARY_ITEM_IMAGE',
      entityType: 'Item',
      entityId: itemId,
      after: image,
    });
    return image;
  }

  @Delete(':imageId')
  async remove(
    @Param('itemId') itemId: string,
    @Param('imageId') imageId: string,
    @Req() request: RequestWithAccess,
  ) {
    await this.itemImagesService.delete(request, itemId, imageId);
    // Not named DELETE_ITEM_IMAGE — AuditLogService.inferOperation matches
    // by string prefix, and a `DELETE_` prefix here would produce a
    // misleading "Item deleted" TransactionLog row against entityType
    // 'Item' when only an attached image was removed, not the item itself.
    await this.auditLogService.record({
      userId: request.user!.id,
      action: 'REMOVE_ITEM_IMAGE',
      entityType: 'Item',
      entityId: itemId,
      before: { imageId },
    });
    return { deleted: true };
  }
}
