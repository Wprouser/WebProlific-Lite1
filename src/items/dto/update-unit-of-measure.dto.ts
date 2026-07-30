import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateUnitOfMeasureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  abbreviation?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Explicit null clears an existing conversion relationship. Pairing
  // (both-or-neither) and the flat-hierarchy rule are enforced in
  // UnitsService, not here, since both require a DB lookup.
  @IsOptional()
  @IsString()
  baseUnitId?: string | null;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'conversionFactor must be a positive decimal with up to 6 places' })
  conversionFactor?: string | null;
}
