import { IsOptional, IsString } from 'class-validator';

export class QuerySupplierPriceHistoryDto {
  @IsOptional()
  @IsString()
  itemId?: string;
}
