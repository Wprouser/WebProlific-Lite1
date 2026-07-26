import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class QuerySuppliersDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
