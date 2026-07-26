import { IsString } from 'class-validator';

/** `outletId` is required in the body — this endpoint's route is flat
 * (`/invoice-scans`), same `body.outletId` precedent as
 * CreatePurchaseOrderDto/CreateDirectGrnDto. */
export class UploadInvoiceScanDto {
  @IsString()
  outletId!: string;
}
