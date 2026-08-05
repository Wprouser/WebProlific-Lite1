import { Type } from 'class-transformer';
import { ArrayMinSize, IsInt, IsOptional, IsUUID, Matches, Min, ValidateNested } from 'class-validator';
import { CreateRecipeLineDto } from './create-recipe-line.dto';

export class CreateRecipeDto {
  /**
   * Optimistic concurrency: the recipe version this edit was based on — the
   * version the editor loaded, or `0` when the menu item had no recipe yet.
   *
   * Necessary because saving submits the *whole* recipe rather than a patch
   * (the API is create-or-replace, auto-versioning). Without this, two people
   * editing the same recipe both succeed and the later save silently discards
   * the earlier one's work: no row is overwritten, but a version nobody
   * reviewed becomes current. With it, the second save is rejected and the
   * user is told to reload.
   *
   * Optional, following the If-Match precondition pattern: omitting it opts
   * out of the check, which keeps seed scripts and one-off API calls working.
   * The Recipe builder screen always sends it.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  basedOnVersion?: number;

  /**
   * FR-05 yield amendment: what one batch of this recipe produces, as a
   * physical quantity. Optional at the DTO layer because a recipe that is
   * never used as a sub-recipe doesn't need one; RecipesService rejects
   * (409) any attempt to reference a yield-less recipe as a sub-recipe.
   *
   * Decimal(12,4). Both-or-neither with yieldUnitId, and > 0 — both checked
   * in the service, since class-validator can't express either rule.
   */
  @IsOptional()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'yieldQuantity must be a non-negative decimal with up to 4 places',
  })
  yieldQuantity?: string;

  @IsOptional()
  @IsUUID()
  yieldUnitId?: string;

  /**
   * ArrayMinSize(1): a recipe with no lines can't be costed and can't deduct
   * stock, and the spec's acceptance criterion ("cannot activate a menu item
   * with zero recipe lines") implies an empty recipe is never useful.
   * Rejecting it at creation is stricter than the spec states, and stated
   * here so the choice is visible rather than incidental.
   */
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRecipeLineDto)
  lines!: CreateRecipeLineDto[];
}
