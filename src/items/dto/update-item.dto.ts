import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'sku must be alphanumeric with hyphens only' })
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'minStock must be a decimal with up to 3 places' })
  minStock?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'maxStock must be a decimal with up to 3 places' })
  maxStock?: string;

  @IsOptional()
  @IsInt()
  shelfLifeDays?: number;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'costPrice must be a decimal with up to 2 places' })
  costPrice?: string;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
