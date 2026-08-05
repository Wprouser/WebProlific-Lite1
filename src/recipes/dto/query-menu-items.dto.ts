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

  /**
   * Opt in to a computed recipe cost per row. Off by default because it costs
   * one full recipe-tree resolution per menu item — the list screen wants it,
   * nothing else should pay for it.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  includeCost?: boolean;

  /**
   * Return only menu items that may legally be used as a sub-recipe — a
   * current recipe with a yield set. Powers the builder's sub-recipe picker.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  subRecipeCandidates?: boolean;

  /** With `subRecipeCandidates`, the recipe being edited — excluded from its
   * own picker, since a recipe cannot contain itself. */
  @IsOptional()
  @IsUUID()
  excludeMenuItemId?: string;
}
