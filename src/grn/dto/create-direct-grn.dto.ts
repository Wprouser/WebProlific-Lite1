import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { CreateGrnLineDto } from './create-grn-line.dto';

/** Flow 1 — Direct GRN (no PO). Spec: "a GRN can never be saved without a
 * supplier" — supplierId is required here exactly like it's a required,
 * non-nullable schema column on GRN itself. */
export class CreateDirectGrnDto {
  // Not in the spec's illustrative request body, but GRN.outletId is a
  // required schema field with no route param to source it from (this
  // endpoint is flat, `/grn/direct`) — same body.outletId precedent as
  // CreatePurchaseOrderDto.
  @IsString()
  outletId!: string;

  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'exchangeRateToBase must be a positive decimal with up to 6 places' })
  exchangeRateToBase?: string;

  @IsOptional()
  @IsBoolean()
  isTaxInclusive?: boolean;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'discountAmount must be a non-negative decimal with up to 2 places' })
  discountAmount?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'otherChargesAmount must be a non-negative decimal with up to 2 places' })
  otherChargesAmount?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  // Present when this GRN is being confirmed from a Scan Invoice session
  // (Flow 3) — the service resolves it to attach the scan's file url onto
  // the created GRN. Never causes anything to be auto-created from the
  // scan itself; the caller still submits fully human-reviewed line data.
  @IsOptional()
  @IsString()
  invoiceScanId?: string;

  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGrnLineDto)
  lines!: CreateGrnLineDto[];
}
