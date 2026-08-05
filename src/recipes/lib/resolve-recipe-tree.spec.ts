import {
  assertNoCycles,
  CircularRecipeError,
  findPathIntoGroup,
  flattenRecipe,
  fromScaled,
  MissingQuantityUnitError,
  MissingSubRecipeError,
  toScaled,
  type ConvertQuantity,
  type LineLookup,
  type RecipeLookup,
  type ResolvableLine,
} from './resolve-recipe-tree';

function item(itemId: string, quantity: string): ResolvableLine {
  return { itemId, subRecipeId: null, quantity, quantityUnitId: null };
}
/** Legacy sub-recipe line: a bare batch multiplier, no unit. */
function sub(subRecipeId: string, quantity: string): ResolvableLine {
  return { itemId: null, subRecipeId, quantity, quantityUnitId: null };
}
/** Post-amendment sub-recipe line: a real quantity in a named unit. */
function subQty(subRecipeId: string, quantity: string, quantityUnitId: string): ResolvableLine {
  return { itemId: null, subRecipeId, quantity, quantityUnitId };
}

/** Lines-only graph — every recipe legacy (no yield). */
function graph(spec: Record<string, ResolvableLine[]>): LineLookup {
  return (recipeId) => spec[recipeId];
}

/** Full recipe graph, for flattening. Entries may declare a yield. */
function recipeGraph(
  spec: Record<string, ResolvableLine[] | { lines: ResolvableLine[]; yieldQuantity: string; yieldUnitId: string }>,
): RecipeLookup {
  return (recipeId) => {
    const entry = spec[recipeId];
    if (entry === undefined) return undefined;
    return Array.isArray(entry)
      ? { lines: entry, yieldQuantity: null, yieldUnitId: null }
      : entry;
  };
}

/** 1 kg = 1000 g; anything else is an unrelated family and throws. */
const FACTORS: Record<string, number> = { kg: 1000, g: 1, l: 1000, ml: 1 };
const FAMILY: Record<string, string> = { kg: 'mass', g: 'mass', l: 'volume', ml: 'volume' };
const convert: ConvertQuantity = (quantity, from, to) => {
  if (FAMILY[from] !== FAMILY[to]) {
    throw new Error(`Cannot convert between unit ${from} and ${to}`);
  }
  return ((Number(quantity) * FACTORS[from]) / FACTORS[to]).toFixed(8);
};

describe('assertNoCycles', () => {
  it('AC: rejects a recipe that contains itself directly', () => {
    const lookup = graph({ A: [sub('A', '1')] });
    expect(() => assertNoCycles('A', lookup)).toThrow(CircularRecipeError);
  });

  it('AC: rejects an indirect cycle (A -> B -> A)', () => {
    const lookup = graph({ A: [sub('B', '1')], B: [sub('A', '1')] });
    expect(() => assertNoCycles('A', lookup)).toThrow(CircularRecipeError);
  });

  it('AC: rejects a deep cycle (A -> B -> C -> A)', () => {
    const lookup = graph({ A: [sub('B', '1')], B: [sub('C', '1')], C: [sub('A', '1')] });
    expect(() => assertNoCycles('A', lookup)).toThrow(CircularRecipeError);
  });

  it('AC: names the offending chain rather than failing opaquely', () => {
    const lookup = graph({ A: [sub('B', '1')], B: [sub('C', '1')], C: [sub('B', '1')] });
    try {
      assertNoCycles('A', lookup);
      fail('expected a CircularRecipeError');
    } catch (error) {
      expect(error).toBeInstanceOf(CircularRecipeError);
      // The cycle is B -> C -> B; A merely leads to it and isn't part of it.
      expect((error as CircularRecipeError).cycle).toEqual(['B', 'C', 'B']);
      expect((error as CircularRecipeError).message).toContain('B -> C -> B');
    }
  });

  it('accepts a diamond — the same sub-recipe reached by two branches is not a cycle', () => {
    // A -> B -> D and A -> C -> D. Naive single-visited-set detection reports
    // this as circular; it is perfectly legal.
    const lookup = graph({
      A: [sub('B', '1'), sub('C', '1')],
      B: [sub('D', '1')],
      C: [sub('D', '1')],
      D: [item('salt', '0.01')],
    });
    expect(() => assertNoCycles('A', lookup)).not.toThrow();
  });

  it('accepts a plain nested chain', () => {
    const lookup = graph({
      A: [sub('B', '1')],
      B: [sub('C', '1')],
      C: [item('flour', '0.5')],
    });
    expect(() => assertNoCycles('A', lookup)).not.toThrow();
  });

  it('reports a dangling sub-recipe reference distinctly from a cycle', () => {
    const lookup = graph({ A: [sub('ghost', '1')] });
    expect(() => assertNoCycles('A', lookup)).toThrow(MissingSubRecipeError);
  });
});

describe('findPathIntoGroup', () => {
  // Recipe ids r1..rN, each owned by a menu item (the "group").
  const owners: Record<string, string> = {
    'r-biryani-v1': 'biryani',
    'r-masala-v1': 'masala',
    'r-stock-v1': 'stock',
  };
  const groupOf = (recipeId: string) => owners[recipeId];

  it('AC: finds a dish reaching an older version of itself through a sub-recipe', () => {
    // Masala v1 contains Biryani v1. Saving a new Biryani recipe that uses
    // Masala closes the loop at the menu-item level.
    const lookup = graph({
      'r-masala-v1': [sub('r-biryani-v1', '1')],
      'r-biryani-v1': [],
    });
    const path = findPathIntoGroup([sub('r-masala-v1', '1')], lookup, groupOf, 'biryani');
    expect(path).toEqual(['r-masala-v1', 'r-biryani-v1']);
  });

  it('AC: finds a direct self-reference', () => {
    const lookup = graph({ 'r-biryani-v1': [] });
    const path = findPathIntoGroup([sub('r-biryani-v1', '1')], lookup, groupOf, 'biryani');
    expect(path).toEqual(['r-biryani-v1']);
  });

  it('returns null for an unrelated tree', () => {
    const lookup = graph({
      'r-masala-v1': [sub('r-stock-v1', '1')],
      'r-stock-v1': [item('water', '1')],
    });
    expect(findPathIntoGroup([sub('r-masala-v1', '1')], lookup, groupOf, 'biryani')).toBeNull();
  });

  it('returns null when the recipe has no sub-recipe lines at all', () => {
    expect(findPathIntoGroup([item('rice', '0.2')], graph({}), groupOf, 'biryani')).toBeNull();
  });

  it('terminates on a pre-existing id cycle in stored data instead of looping', () => {
    const lookup = graph({ X: [sub('Y', '1')], Y: [sub('X', '1')] });
    expect(findPathIntoGroup([sub('X', '1')], lookup, () => undefined, 'biryani')).toBeNull();
  });
});

describe('flattenRecipe — legacy recipes (no yield)', () => {
  // These recipes predate the yield amendment. Their sub-recipe lines are
  // still batch multipliers, and MUST keep resolving to exactly what they
  // always did — past sales are pinned to these versions.

  it('returns direct ingredients unchanged', () => {
    const lookup = recipeGraph({ A: [item('flour', '0.2500'), item('salt', '0.0050')] });
    expect(flattenRecipe('A', lookup, convert).ingredients).toEqual([
      { itemId: 'flour', quantity: '0.25' },
      { itemId: 'salt', quantity: '0.005' },
    ]);
  });

  it('a recipe of only raw ingredients is not flagged as legacy', () => {
    // No sub-recipe is traversed, so nothing legacy was relied on.
    const lookup = recipeGraph({ A: [item('flour', '1')] });
    expect(flattenRecipe('A', lookup, convert).usesLegacyBatchMultiplier).toBe(false);
  });

  it('AC: a yield-less sub-recipe still resolves by batch multiplier, and is flagged', () => {
    const lookup = recipeGraph({
      A: [sub('sauce', '2')],
      sauce: [item('tomato', '0.3'), item('oil', '0.05')],
    });
    const result = flattenRecipe('A', lookup, convert);
    expect(result.ingredients).toEqual([
      { itemId: 'tomato', quantity: '0.6' },
      { itemId: 'oil', quantity: '0.1' },
    ]);
    expect(result.usesLegacyBatchMultiplier).toBe(true);
  });

  it('compounds multipliers through nested legacy sub-recipes', () => {
    const lookup = recipeGraph({
      A: [sub('B', '2')],
      B: [sub('C', '3')],
      C: [item('stock', '0.1')],
    });
    expect(flattenRecipe('A', lookup, convert).ingredients).toEqual([
      { itemId: 'stock', quantity: '0.6' },
    ]);
  });

  it('sums an item reached both directly and through a sub-recipe', () => {
    const lookup = recipeGraph({
      A: [item('salt', '0.002'), sub('sauce', '1')],
      sauce: [item('salt', '0.003')],
    });
    expect(flattenRecipe('A', lookup, convert).ingredients).toEqual([
      { itemId: 'salt', quantity: '0.005' },
    ]);
  });

  it('sums an item reached through both arms of a diamond', () => {
    const lookup = recipeGraph({
      A: [sub('B', '1'), sub('C', '2')],
      B: [sub('D', '1')],
      C: [sub('D', '1')],
      D: [item('butter', '0.05')],
    });
    expect(flattenRecipe('A', lookup, convert).ingredients).toEqual([
      { itemId: 'butter', quantity: '0.15' },
    ]);
  });

  it('does not accumulate binary floating-point error', () => {
    const lookup = recipeGraph({ A: [item('x', '0.1'), item('x', '0.2')] });
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 doubles.
    expect(flattenRecipe('A', lookup, convert).ingredients).toEqual([
      { itemId: 'x', quantity: '0.3' },
    ]);
  });

  it('AC: refuses to flatten a circular graph instead of looping forever', () => {
    const lookup = recipeGraph({ A: [sub('B', '1')], B: [sub('A', '1')] });
    expect(() => flattenRecipe('A', lookup, convert)).toThrow(CircularRecipeError);
  });

  it('handles an empty recipe', () => {
    expect(flattenRecipe('A', recipeGraph({ A: [] }), convert).ingredients).toEqual([]);
  });
});

describe('flattenRecipe — yield-based resolution', () => {
  it('AC: divides a real quantity by the batch yield instead of taking a multiplier', () => {
    // Sauce batch yields 2 kg from 1.5 kg tomato. A dish uses 0.5 kg of it,
    // i.e. a quarter of a batch -> 0.375 kg tomato.
    const lookup = recipeGraph({
      dish: [subQty('sauce', '0.5', 'kg')],
      sauce: { lines: [item('tomato', '1.5')], yieldQuantity: '2', yieldUnitId: 'kg' },
    });
    const result = flattenRecipe('dish', lookup, convert);
    expect(result.ingredients).toEqual([{ itemId: 'tomato', quantity: '0.375' }]);
    expect(result.usesLegacyBatchMultiplier).toBe(false);
  });

  it('AC: the non-terminating case that motivated the amendment stays precise', () => {
    // 200 g out of a 3 kg batch. As a human-entered 4dp multiplier this was
    // 0.0667, drifting ~66.7 g per 1000 portions. Computed at 8dp it is
    // 0.06666666, and 2 kg of tomato per batch gives 0.13333332 kg —
    // three orders of magnitude closer to the true 0.13333333...
    const lookup = recipeGraph({
      dish: [subQty('sauce', '0.2', 'kg')],
      sauce: { lines: [item('tomato', '2')], yieldQuantity: '3', yieldUnitId: 'kg' },
    });
    const [tomato] = flattenRecipe('dish', lookup, convert).ingredients;
    const drift = Math.abs(Number(tomato.quantity) - 2 * (0.2 / 3));
    expect(drift).toBeLessThan(1e-7);
    // For contrast: the old human-rounded 0.0667 multiplier gave 0.1334,
    // a drift of ~6.7e-5 — three orders of magnitude worse.
    expect(Math.abs(0.1334 - 2 * (0.2 / 3))).toBeGreaterThan(1e-5);
  });

  it('AC: converts when the line unit differs from the yield unit', () => {
    // Line says 500 g; the sauce yields 2 kg. Same family, so FR-01's
    // conversion applies: 0.5 kg / 2 kg = a quarter batch.
    const lookup = recipeGraph({
      dish: [subQty('sauce', '500', 'g')],
      sauce: { lines: [item('tomato', '1.5')], yieldQuantity: '2', yieldUnitId: 'kg' },
    });
    expect(flattenRecipe('dish', lookup, convert).ingredients).toEqual([
      { itemId: 'tomato', quantity: '0.375' },
    ]);
  });

  it('AC: rejects a line whose unit family is unrelated to the yield unit', () => {
    const lookup = recipeGraph({
      dish: [subQty('sauce', '1', 'l')],
      sauce: { lines: [item('tomato', '1.5')], yieldQuantity: '2', yieldUnitId: 'kg' },
    });
    expect(() => flattenRecipe('dish', lookup, convert)).toThrow(/Cannot convert/);
  });

  it('skips conversion entirely when the units already match', () => {
    const spy = jest.fn(convert);
    const lookup = recipeGraph({
      dish: [subQty('sauce', '1', 'kg')],
      sauce: { lines: [item('tomato', '2')], yieldQuantity: '2', yieldUnitId: 'kg' },
    });
    expect(flattenRecipe('dish', lookup, spy).ingredients).toEqual([
      { itemId: 'tomato', quantity: '1' },
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('compounds correctly through two yield-based levels', () => {
    // dish uses 1 kg of sauce (batch 2 kg); sauce uses 0.5 kg of stock
    // (batch 4 kg, containing 2 kg bones).
    // dish -> 0.5 batch sauce -> 0.5 * 0.5 kg = 0.25 kg stock
    //      -> 0.25/4 = 0.0625 batch stock -> 0.0625 * 2 = 0.125 kg bones
    const lookup = recipeGraph({
      dish: [subQty('sauce', '1', 'kg')],
      sauce: { lines: [subQty('stock', '0.5', 'kg')], yieldQuantity: '2', yieldUnitId: 'kg' },
      stock: { lines: [item('bones', '2')], yieldQuantity: '4', yieldUnitId: 'kg' },
    });
    expect(flattenRecipe('dish', lookup, convert).ingredients).toEqual([
      { itemId: 'bones', quantity: '0.125' },
    ]);
  });

  it('flags legacy when a mixed tree has a yield-less node anywhere in it', () => {
    const lookup = recipeGraph({
      dish: [subQty('sauce', '1', 'kg')],
      sauce: { lines: [sub('oldBase', '1')], yieldQuantity: '2', yieldUnitId: 'kg' },
      oldBase: [item('flour', '1')],
    });
    expect(flattenRecipe('dish', lookup, convert).usesLegacyBatchMultiplier).toBe(true);
  });

  it('rejects a sub-recipe line with a yield-bearing child but no unit on the line', () => {
    const lookup = recipeGraph({
      dish: [sub('sauce', '1')],
      sauce: { lines: [item('tomato', '1')], yieldQuantity: '2', yieldUnitId: 'kg' },
    });
    expect(() => flattenRecipe('dish', lookup, convert)).toThrow(MissingQuantityUnitError);
  });

  it('refuses a zero yield rather than dividing by it', () => {
    const lookup = recipeGraph({
      dish: [subQty('sauce', '1', 'kg')],
      sauce: { lines: [item('tomato', '1')], yieldQuantity: '0', yieldUnitId: 'kg' },
    });
    expect(() => flattenRecipe('dish', lookup, convert)).toThrow(/zero yield/);
  });
});


describe('decimal scaling helpers', () => {
  it.each([
    ['0', '0'],
    ['1', '1'],
    ['0.25', '0.25'],
    ['0.0025', '0.0025'],
    ['12.3456', '12.3456'],
    ['-0.5', '-0.5'],
  ])('round-trips %s', (input, expected) => {
    expect(fromScaled(toScaled(input))).toBe(expected);
  });

  it('truncates beyond the working precision rather than throwing', () => {
    expect(fromScaled(toScaled('0.1234567891'))).toBe('0.12345678');
  });
});
