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

export class CreateTaxRateDto {
  // Not required from a route param — FR-04's tax-rate endpoints are flat
  // (no /outlets/:outletId/tax-rates nesting), same reasoning as
  // CreateItemDto's outletId-in-body precedent.
  @IsString()
  outletId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  // For a compound rate this must equal the sum of `components` — checked
  // in TaxRatesService, not expressible via this format-only regex.
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'ratePercent must be a decimal with up to 2 places' })
  ratePercent!: string;

  @IsOptional()
  @IsBoolean()
  isCompound?: boolean;

  @IsOptional()
  @IsString()
  countryCode?: string;

  // At least 1 (not 2) — India's inter-state GST is a single IGST
  // component, still modeled as compound for consistency. The form's own
  // default UI state starts with 2 rows, but that's a UI nudge, not a save
  // constraint.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaxRateComponentDto)
  components?: TaxRateComponentDto[];
}
