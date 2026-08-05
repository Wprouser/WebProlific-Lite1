/**
 * Decimal places recipe resolution asks convertUnitQuantity for.
 *
 * FR-01's default is 3, matching Decimal(10,3) stock quantities. Recipes need
 * more: a sub-recipe conversion is divided by the batch yield straight
 * afterwards, and rounding to 3dp before that division reintroduces exactly
 * the drift the yield amendment exists to remove (~66.7 g per 1,000 portions
 * on a 200 g-of-a-3 kg-batch line). 8 also matches the working precision of
 * resolve-recipe-tree's fixed-point arithmetic, so nothing is lost in between.
 */
export const RECIPE_PRECISION = 8;
