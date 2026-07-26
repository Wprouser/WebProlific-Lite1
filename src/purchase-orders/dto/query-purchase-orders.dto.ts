import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PO_STATUSES } from '../constants/enums';

export class QueryPurchaseOrdersDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  @IsOptional()
  @IsIn(PO_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
