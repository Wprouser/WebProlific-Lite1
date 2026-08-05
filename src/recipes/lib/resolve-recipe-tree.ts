/**
 * FR-05: recursive sub-recipe resolution.
 *
 * Pure functions over plain data — no repository, no Prisma, no Nest. The
 * spec's hardest requirement here ("detect and reject circular sub-recipe
 * references at save time, not an infinite loop") is graph logic, so keeping
 * it separable means it can be tested exhaustively against hand-built graphs
 * instead of through fixture rows.
 */

export interface ResolvableLine {
  itemId: string | null;
  subRecipeId: string | null;
  /** Decimal string, as it comes back from Prisma. */
  quantity: string;
  /**
   * FR-05 yield amendment: the unit `quantity` is expressed in for a
   * sub-recipe line. Null on raw-ingredient lines, and on legacy sub-recipe
   * lines written before the amendment.
   */
  quantityUnitId: string | null;
}

export interface ResolvableRecipe {
  lines: ResolvableLine[];
  /** Null on recipes predating the yield amendment — see resolveMultiplier. */
  yieldQuantity: string | null;
  yieldUnitId: string | null;
}

/** Reads a recipe by id. Supplied by the caller (service). */
export type RecipeLookup = (recipeId: string) => ResolvableRecipe | undefined;

/**
 * Converts a quantity between two units at the given precision. Injected so
 * this module stays free of Prisma and of the UnitOfMeasure repository —
 * in practice it wraps FR-01's convertUnitQuantity with decimalPlaces: 8.
 * Throws when the units belong to unrelated families.
 */
export type ConvertQuantity = (quantity: string, fromUnitId: string, toUnitId: string) => string;

/** Lines-only view, for the two cycle checks that don't care about yield. */
export type LineLookup = (recipeId: string) => ResolvableLine[] | undefined;

export function linesOf(lookup: RecipeLookup): LineLookup {
  return (recipeId) => lookup(recipeId)?.lines;
}

export class CircularRecipeError extends Error {
  /** The reference chain that closed the loop, e.g. [A, B, A]. */
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Circular sub-recipe reference: ${cycle.join(' -> ')}`);
    this.name = 'CircularRecipeError';
    this.cycle = cycle;
  }
}

export class MissingSubRecipeError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super(`Sub-recipe ${recipeId} does not exist`);
    this.name = 'MissingSubRecipeError';
    this.recipeId = recipeId;
  }
}

/**
 * Depth cap as a backstop only. Cycle detection below is what actually
 * guarantees termination; this catches a lookup that returns fresh ids
 * forever (a bug elsewhere) rather than hanging the request thread.
 */
const MAX_DEPTH = 32;

/**
 * Walks the sub-recipe graph depth-first and throws CircularRecipeError if a
 * recipe transitively contains itself.
 *
 * `path` (the current DFS branch) is what detects cycles; `settled` (branches
 * already fully explored) is what keeps a diamond — A needing both B and C,
 * which both need D — from being misreported as circular. Using a single
 * "visited" set for both jobs is the classic bug here: D would be seen twice
 * on legitimately different branches and rejected.
 */
export function assertNoCycles(rootRecipeId: string, lookup: LineLookup): void {
  const settled = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  function visit(recipeId: string): void {
    if (onPath.has(recipeId)) {
      throw new CircularRecipeError([...path.slice(path.indexOf(recipeId)), recipeId]);
    }
    if (settled.has(recipeId)) return;
    if (path.length >= MAX_DEPTH) {
      throw new CircularRecipeError([...path, recipeId]);
    }

    const lines = lookup(recipeId);
    if (lines === undefined) throw new MissingSubRecipeError(recipeId);

    path.push(recipeId);
    onPath.add(recipeId);
    for (const line of lines) {
      if (line.subRecipeId) visit(line.subRecipeId);
    }
    onPath.delete(recipeId);
    path.pop();
    settled.add(recipeId);
  }

  visit(rootRecipeId);
}

/**
 * Finds a path from `rootLines` to the first reachable recipe belonging to
 * `forbiddenGroup`, or null if there is none.
 *
 * This is what actually catches the spec's "A contains B contains A" case.
 * Because a sub-recipe line pins a specific Recipe *version*, and a version
 * can only reference rows that already existed when it was created, a cycle
 * in the recipe-id graph is impossible to create through the API — the graph
 * is a DAG ordered by creation time. What a user can still do is build a
 * recipe for dish A that reaches an *older version of dish A*. That
 * terminates arithmetically, so `assertNoCycles` won't flag it, but it is the
 * same modelling error and produces nonsense costs (a dish containing its own
 * past self). Grouping by menu item is what makes it visible.
 *
 * `groupOf` maps a recipe id to its menu item id.
 */
export function findPathIntoGroup(
  rootLines: ResolvableLine[],
  lookup: LineLookup,
  groupOf: (recipeId: string) => string | undefined,
  forbiddenGroup: string,
): string[] | null {
  const seen = new Set<string>();
  // BFS over recipe ids, carrying the path taken to reach each one so the
  // error can name the whole chain rather than just the endpoint.
  const queue: string[][] = [];

  for (const line of rootLines) {
    if (line.subRecipeId) queue.push([line.subRecipeId]);
  }

  while (queue.length > 0) {
    const path = queue.shift()!;
    const recipeId = path[path.length - 1];
    if (seen.has(recipeId)) continue;
    seen.add(recipeId);

    if (groupOf(recipeId) === forbiddenGroup) return path;

    for (const line of lookup(recipeId) ?? []) {
      if (line.subRecipeId && !seen.has(line.subRecipeId)) {
        queue.push([...path, line.subRecipeId]);
      }
    }
  }

  return null;
}

export interface FlattenedIngredient {
  itemId: string;
  /** Total quantity of this item across the whole tree, as a decimal string. */
  quantity: string;
}

export interface FlattenResult {
  ingredients: FlattenedIngredient[];
  /**
   * True when any sub-recipe in the tree still lacks a yield, so its line
   * quantity had to be read as a batch multiplier. Surfaced through
   * GET /menu-items/:id/cost so the remaining legacy recipes are a visible
   * worklist rather than a silent inaccuracy.
   */
  usesLegacyBatchMultiplier: boolean;
}

export class MissingQuantityUnitError extends Error {
  constructor(readonly recipeId: string) {
    super(`Sub-recipe line referencing ${recipeId} has a yield but no quantityUnitId`);
    this.name = 'MissingQuantityUnitError';
  }
}

/**
 * Flattens a recipe (and everything it transitively contains) into raw-item
 * totals. A sub-recipe line's quantity multiplies everything beneath it —
 * Recipe has no yield/batch-size column, so it reads as "N batches of that
 * sub-recipe", which is the only meaning the spec's model can express.
 *
 * The same item appearing via several branches is summed once, so a dish
 * using salt directly and via a sauce reports one combined salt figure.
 *
 * Arithmetic is done in scaled integers, not floats: 0.1 + 0.2 in binary
 * floating point is 0.30000000000000004, and these numbers get multiplied up
 * a tree and then priced.
 */
export function flattenRecipe(
  rootRecipeId: string,
  lookup: RecipeLookup,
  convert: ConvertQuantity,
): FlattenResult {
  assertNoCycles(rootRecipeId, linesOf(lookup));

  const totals = new Map<string, bigint>();
  const order: string[] = [];
  let usesLegacyBatchMultiplier = false;

  /**
   * How much of a sub-recipe's batch one line consumes, as a SCALE-scaled
   * fraction.
   *
   * The whole point of the yield amendment lives here. With a yield, the line
   * says "0.2 kg of sauce" and the division by the batch size happens once, at
   * full working precision. Without one (legacy rows), the line is still a
   * batch count and is used as-is — deliberately, so historical recipes keep
   * resolving to exactly what they always did.
   */
  function resolveMultiplier(line: ResolvableLine, child: ResolvableRecipe): bigint {
    if (child.yieldQuantity === null || child.yieldUnitId === null) {
      usesLegacyBatchMultiplier = true;
      return toScaled(line.quantity);
    }

    if (!line.quantityUnitId) throw new MissingQuantityUnitError(line.subRecipeId!);

    const inYieldUnit =
      line.quantityUnitId === child.yieldUnitId
        ? line.quantity
        : convert(line.quantity, line.quantityUnitId, child.yieldUnitId);

    const yieldScaled = toScaled(child.yieldQuantity);
    if (yieldScaled === 0n) {
      throw new Error(`Sub-recipe ${line.subRecipeId} has a zero yield and cannot be resolved`);
    }
    // Multiply up by SCALE first so the division keeps all 8 working places
    // instead of truncating toward zero on the way in.
    return (toScaled(inYieldUnit) * SCALE) / yieldScaled;
  }

  function walk(recipeId: string, multiplier: bigint): void {
    const recipe = lookup(recipeId);
    if (recipe === undefined) throw new MissingSubRecipeError(recipeId);

    for (const line of recipe.lines) {
      if (line.itemId) {
        // multiplier and the line quantity are both SCALE-scaled, so their
        // product is SCALE^2-scaled — divide once to get back to SCALE.
        const contribution = (toScaled(line.quantity) * multiplier) / SCALE;
        if (!totals.has(line.itemId)) order.push(line.itemId);
        totals.set(line.itemId, (totals.get(line.itemId) ?? 0n) + contribution);
      } else if (line.subRecipeId) {
        const child = lookup(line.subRecipeId);
        if (child === undefined) throw new MissingSubRecipeError(line.subRecipeId);
        const share = resolveMultiplier(line, child);
        walk(line.subRecipeId, (share * multiplier) / SCALE);
      }
    }
  }

  walk(rootRecipeId, SCALE);

  return {
    ingredients: order.map((itemId) => ({ itemId, quantity: fromScaled(totals.get(itemId)!) })),
    usesLegacyBatchMultiplier,
  };
}

/**
 * Fixed-point scale for the intermediate maths. 8 decimal places — wider than
 * the 4 that RecipeLine.quantity stores, so that nesting several sub-recipes
 * deep doesn't compound rounding into the stored precision.
 */
const DECIMALS = 8;
const SCALE = 10n ** BigInt(DECIMALS);

export function toScaled(decimal: string): bigint {
  const trimmed = decimal.trim();
  const negative = trimmed.startsWith('-');
  const [whole, fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const padded = (fraction + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  const value = BigInt(whole || '0') * SCALE + BigInt(padded || '0');
  return negative ? -value : value;
}

export function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}
