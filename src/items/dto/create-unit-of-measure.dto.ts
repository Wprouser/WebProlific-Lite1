import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateUnitOfMeasureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  abbreviation!: string;

  // Same rationale as CreateCategoryDto.outletId — no route param to source
  // it from, so it belongs in the body.
  @IsString()
  outletId!: string;

  // Optional — a unit with neither field is its own independent base unit
  // (spec: "conversion support is opt-in per unit family"). Pairing
  // (both-or-neither) and the flat-hierarchy rule are enforced in
  // UnitsService, not here, since both require a DB lookup.
  @IsOptional()
  @IsString()
  baseUnitId?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'conversionFactor must be a positive decimal with up to 6 places' })
  conversionFactor?: string;
}
