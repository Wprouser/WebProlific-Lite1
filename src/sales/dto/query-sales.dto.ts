import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { SALE_SOURCE_TYPES, SaleSourceType } from '../constants/enums';

export class QuerySalesDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  @IsOptional()
  @IsString()
  menuItemId?: string;

  @IsOptional()
  @IsIn(SALE_SOURCE_TYPES)
  sourceType?: SaleSourceType;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /** Only sales that deducted nothing because the menu item had no recipe. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  unmappedOnly?: boolean;
}
