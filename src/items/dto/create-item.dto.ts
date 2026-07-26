import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UNITS, Unit } from '../constants/enums';

export class OpeningStockDto {
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'quantity must be a decimal with up to 3 places' })
  quantity!: string;

  // See ItemRepository's OpeningStockInput doc comment — validated for
  // API-contract fidelity but not persisted as its own column.
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'ratePerUnit must be a decimal with up to 2 places' })
  ratePerUnit?: string;
}

export class CreateItemDto {
  // Not in the spec's illustrative request body, but Item.outletId is a
  // required schema field with no route param to source it from (FR-01's
  // endpoints are flat, unlike Outlet's own /properties/:propertyId/outlets
  // nesting) — so it belongs in the body, same as FR-13's
  // `body.chainId` precedent.
  @IsString()
  outletId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  categoryId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'sku must be alphanumeric with hyphens only' })
  sku!: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsIn(UNITS)
  unit!: Unit;

  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'minStock must be a decimal with up to 3 places' })
  minStock!: string;

  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'maxStock must be a decimal with up to 3 places' })
  maxStock!: string;

  @IsOptional()
  @IsInt()
  shelfLifeDays?: number;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'costPrice must be a decimal with up to 2 places' })
  costPrice!: string;

  @IsOptional()
  @IsString()
  defaultSupplierId?: string;

  @IsOptional()
  @IsString()
  purchaseGLAccount?: string;

  @IsOptional()
  @IsString()
  defaultTaxRateId?: string;

  @IsOptional()
  @IsString()
  storageLocation?: string;

  // Captured at creation time rather than as a separate manual stock-in
  // step — see FR-01 spec's Business Logic: "the endpoint never writes
  // currentStock as a raw field itself, even in that case."
  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningStockDto)
  openingStock?: OpeningStockDto;
}
