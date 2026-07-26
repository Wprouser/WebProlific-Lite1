import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class QueryTaxRatesDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  // Omitted = both active and inactive rows, same convention as
  // QueryItemsDto's isActive — the Tax Configuration screen needs to show
  // deactivated rates too, not just what's currently selectable.
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
