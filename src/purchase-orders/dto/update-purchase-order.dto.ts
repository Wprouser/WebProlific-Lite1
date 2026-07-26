import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CreatePOLineDto } from './create-po-line.dto';

// DRAFT-only edit path (spec doesn't define a generic PATCH endpoint, but
// the workflow needs one before a PO is submitted — see
// PurchaseOrdersService.update's own doc comment). Same fields as create,
// all optional; providing `lines` replaces the whole set.
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

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
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePOLineDto)
  lines?: CreatePOLineDto[];
}
