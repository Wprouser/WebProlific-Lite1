import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class QueryUnitsDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  // Omitted = both active and inactive rows — the Unit Management screen
  // needs to show deactivated units too, not just what's currently
  // selectable on the Item form.
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
