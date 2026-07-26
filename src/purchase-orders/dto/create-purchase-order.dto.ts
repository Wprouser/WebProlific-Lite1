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

export class CreatePurchaseOrderDto {
  // Not in the spec's illustrative request body, but PurchaseOrder.outletId
  // is a required schema field with no route param to source it from
  // (FR-04's endpoints are flat) — same body.outletId precedent as
  // CreateItemDto/CreateSupplierDto.
  @IsString()
  outletId!: string;

  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  // User-editable inline on the form (spec's UX enhancement) — if omitted,
  // the service auto-derives it from the latest ExchangeRate row (or 1 if
  // the currency matches the outlet's base currency).
  @IsOptional()
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'exchangeRateToBase must be a positive decimal with up to 6 places' })
  exchangeRateToBase?: string;

  @IsOptional()
  @IsBoolean()
  isTaxInclusive?: boolean;

  // Optional manual reduction — non-negative; the sign is implicit in the
  // field's meaning (spec: "Discount reduces the total").
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'discountAmount must be a non-negative decimal with up to 2 places' })
  discountAmount?: string;

  // Optional manual addition (rounding, freight, misc.) — non-negative.
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'otherChargesAmount must be a non-negative decimal with up to 2 places' })
  otherChargesAmount?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePOLineDto)
  lines!: CreatePOLineDto[];
}
