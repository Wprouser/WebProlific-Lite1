export interface RecipeLine {
  id: string;
  recipeId: string;
  /** Exactly one of itemId / subRecipeId is non-null. */
  itemId: string | null;
  subRecipeId: string | null;
  /** Decimal(10,4) as a string — never a JS number, which can't hold it exactly. */
  quantity: string;
  /**
   * FR-05 yield amendment: the unit `quantity` is expressed in on a
   * sub-recipe line. Null for raw-ingredient lines (implicitly the item's own
   * stocking unit) and for legacy sub-recipe lines still read as batch counts.
   */
  quantityUnitId: string | null;
}

export interface Recipe {
  id: string;
  menuItemId: string;
  version: number;
  isCurrent: boolean;
  createdAt: Date;
  /**
   * FR-05 yield amendment: what one batch of this recipe produces. Both-or-
   * neither with yieldUnitId; null on recipes predating the amendment.
   */
  yieldQuantity: string | null;
  yieldUnitId: string | null;
  lines: RecipeLine[];
}
