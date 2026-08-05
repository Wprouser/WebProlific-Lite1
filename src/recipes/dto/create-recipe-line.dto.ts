import { IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateRecipeLineDto {
  /**
   * Exactly one of itemId / subRecipeId must be set — enforced in
   * RecipesService rather than here, because class-validator can express
   * "optional" per field but not "exactly one of these two", and the spec
   * wants a single clear 400 rather than two unrelated field errors.
   */
  @IsOptional()
  @IsUUID()
  itemId?: string;

  /** A Recipe id (a specific version), not a MenuItem id — see the schema note. */
  @IsOptional()
  @IsUUID()
  subRecipeId?: string;

  // Decimal(10,4). Must be > 0: a zero-quantity line consumes nothing and is
  // almost always a data-entry slip rather than an intention.
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'quantity must be a non-negative decimal with up to 4 places',
  })
  quantity!: string;

  /**
   * FR-05 yield amendment: the unit `quantity` is expressed in for a
   * sub-recipe line ("0.2 kg of sauce"). Required whenever the referenced
   * sub-recipe has a yield — enforced in RecipesService, which is the only
   * place that can see the child recipe. Never set on raw-ingredient lines,
   * which stay in the item's own stocking unit.
   */
  @IsOptional()
  @IsUUID()
  quantityUnitId?: string;
}
