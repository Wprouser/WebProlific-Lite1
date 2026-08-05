import { Transform } from 'class-transformer';
import { IsBooleanString, IsOptional, IsString, IsUUID } from 'class-validator';

export class QueryMenuItemsDto {
  @IsOptional()
  @IsUUID()
  outletId?: string;

  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value)
  isActive?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
