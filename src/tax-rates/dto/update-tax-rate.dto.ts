import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TaxRateComponentDto } from './tax-rate-component.dto';

export class UpdateTaxRateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'ratePercent must be a decimal with up to 2 places' })
  ratePercent?: string;

  @IsOptional()
  @IsBoolean()
  isCompound?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaxRateComponentDto)
  components?: TaxRateComponentDto[];

  // Mirrors Item's own UpdateItemDto precedent — PATCH can set isActive
  // directly (used by the Add/Edit form's Active toggle), alongside the
  // dedicated DELETE /tax-rates/:id route the list screen's quick
  // "Deactivate" action uses. Both end up calling the same repository
  // update underneath.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
