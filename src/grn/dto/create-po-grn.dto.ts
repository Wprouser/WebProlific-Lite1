import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { CreateGrnLineDto } from './create-grn-line.dto';

/** Flow 2 — Against a PO. `purchaseOrderId` comes from the route param
 * (`POST /purchase-orders/:id/grn`), not the body — see GrnController. */
export class CreatePoGrnDto {
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

  // See CreateDirectGrnDto's identical field for why this exists.
  @IsOptional()
  @IsString()
  invoiceScanId?: string;

  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGrnLineDto)
  lines!: CreateGrnLineDto[];
}
