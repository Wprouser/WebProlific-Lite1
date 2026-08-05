import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RECIPE_REPOSITORY } from '../repositories/tokens';
import { RecipeRepository } from '../repositories/recipe.repository';
import { ITEM_REPOSITORY, UNIT_OF_MEASURE_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { UnitOfMeasureRepository } from '../../items/repositories/unit-of-measure.repository';
import { convertUnitQuantity, type ConvertibleUnit } from '../../items/lib/convert-unit';
import { RECIPE_PRECISION } from '../lib/precision';
import { Recipe } from '../domain/recipe.entity';
import {
  CircularRecipeError,
  flattenRecipe,
  MissingQuantityUnitError,
  MissingSubRecipeError,
  toScaled,
  type ConvertQuantity,
  type RecipeLookup,
  type ResolvableRecipe,
} from '../lib/resolve-recipe-tree';
import { BadRequestException } from '@nestjs/common';

export interface RecipeCostComponent {
  itemId: string;
  itemName: string;
  /** Total quantity consumed across the whole tree, in the item's own unit. */
  quantity: string;
  unitId: string;
  /** Item.costPrice at the time of this call. */
  unitCost: string;
  /** quantity x unitCost, rounded to 2dp. */
  lineCost: string;
}

export interface RecipeCost {
  menuItemId: string;
  recipeId: string;
  recipeVersion: number;
  /** Sum of every component's lineCost, 2dp. */
  totalCost: string;
  components: RecipeCostComponent[];
  /**
   * FR-05 yield amendment: true when this cost traversed a sub-recipe that
   * still has no yield, so its quantity was read as a batch multiplier.
   * Exposed so the remaining legacy recipes are a trackable worklist rather
   * than a silent inaccuracy — see the spec's "Migration — no backfill".
   */
  usesLegacyBatchMultiplier: boolean;
}

@Injectable()
export class RecipeCostService {
  constructor(
    @Inject(RECIPE_REPOSITORY) private readonly recipeRepository: RecipeRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly unitRepository: UnitOfMeasureRepository,
  ) {}

  /**
   * Costs a specific recipe version from *current* ingredient prices, per the
   * spec ("Computed recipe cost from current ingredient prices").
   *
   * Note the asymmetry, which is deliberate and is what the versioning buys:
   * the ingredient *list* is historical (whatever that version contained),
   * while the *prices* are today's. Costing a past sale therefore answers
   * "what would that dish cost to make now", not "what did it cost then" —
   * the latter would need price history per item, which FR-05 doesn't model.
   */
  async costRecipeVersion(menuItemId: string, version?: number): Promise<RecipeCost> {
    const recipe =
      version === undefined
        ? await this.recipeRepository.findCurrentByMenuItemId(menuItemId)
        : await this.recipeRepository.findByMenuItemIdAndVersion(menuItemId, version);

    if (!recipe) {
      throw new NotFoundException(
        version === undefined
          ? 'This menu item has no recipe yet'
          : `Recipe version ${version} not found for this menu item`,
      );
    }

    const { lookup, convert } = await this.buildLookup(recipe);

    let flattened;
    try {
      flattened = flattenRecipe(recipe.id, lookup, convert);
    } catch (error) {
      // Cycles are rejected at save time, so reaching here means stored data
      // predates that check or was written out of band. Surface it as a 400
      // with the offending chain rather than letting the request hang.
      if (error instanceof CircularRecipeError) {
        throw new BadRequestException(
          `This recipe contains a circular sub-recipe reference (${error.cycle.join(' -> ')}) and cannot be costed.`,
        );
      }
      if (error instanceof MissingSubRecipeError) {
        throw new BadRequestException(
          `This recipe references sub-recipe ${error.recipeId}, which no longer exists.`,
        );
      }
      if (error instanceof MissingQuantityUnitError) {
        throw new BadRequestException(
          `A line referencing sub-recipe ${error.recipeId} has no unit, but that recipe has a yield — the quantity cannot be resolved.`,
        );
      }
      throw error;
    }

    const components: RecipeCostComponent[] = [];
    let totalScaled = 0n;

    for (const ingredient of flattened.ingredients) {
      const item = await this.itemRepository.findById(ingredient.itemId);
      if (!item) {
        throw new BadRequestException(
          `This recipe references item ${ingredient.itemId}, which no longer exists.`,
        );
      }

      const lineScaled = (toScaled(ingredient.quantity) * toScaled(item.costPrice)) / SCALE;
      totalScaled += lineScaled;

      components.push({
        itemId: item.id,
        itemName: item.name,
        quantity: ingredient.quantity,
        unitId: item.unitId,
        unitCost: item.costPrice,
        lineCost: round2(lineScaled),
      });
    }

    return {
      menuItemId,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      // Totalled at full precision and rounded once, rather than summing
      // already-rounded line costs — otherwise a recipe with many sub-cent
      // lines drifts from its own components.
      totalCost: round2(totalScaled),
      components,
      usesLegacyBatchMultiplier: flattened.usesLegacyBatchMultiplier,
    };
  }

  /**
   * Loads every recipe reachable from the root into a lookup the pure tree
   * walker can use. Breadth-first and de-duplicated, so a diamond loads each
   * node once and a (stored) cycle terminates the load rather than hanging.
   */
  private async buildLookup(
    root: Recipe,
  ): Promise<{ lookup: RecipeLookup; convert: ConvertQuantity }> {
    const loaded = new Map<string, ResolvableRecipe>([
      [
        root.id,
        { lines: root.lines, yieldQuantity: root.yieldQuantity, yieldUnitId: root.yieldUnitId },
      ],
    ]);
    let frontier = [
      ...new Set(root.lines.map((l) => l.subRecipeId).filter((id): id is string => !!id)),
    ];

    while (frontier.length > 0) {
      // findById rather than findLinesForRecipeIds: the tree walk now needs
      // each node's yield as well as its lines.
      const fetched = await Promise.all(frontier.map((id) => this.recipeRepository.findById(id)));
      const next: string[] = [];
      for (const child of fetched) {
        if (!child) continue;
        loaded.set(child.id, {
          lines: child.lines,
          yieldQuantity: child.yieldQuantity,
          yieldUnitId: child.yieldUnitId,
        });
        for (const line of child.lines) {
          if (line.subRecipeId && !loaded.has(line.subRecipeId)) next.push(line.subRecipeId);
        }
      }
      frontier = [...new Set(next)];
    }

    // Pre-load every unit the tree could need, so the pure resolver can stay
    // synchronous rather than being made async for a handful of lookups.
    const unitIds = new Set<string>();
    for (const recipe of loaded.values()) {
      if (recipe.yieldUnitId) unitIds.add(recipe.yieldUnitId);
      for (const line of recipe.lines) {
        if (line.quantityUnitId) unitIds.add(line.quantityUnitId);
      }
    }
    const units = new Map<string, ConvertibleUnit>();
    for (const unitId of unitIds) {
      const unit = await this.unitRepository.findById(unitId);
      if (unit) units.set(unitId, unit);
    }

    const convert: ConvertQuantity = (quantity, fromUnitId, toUnitId) => {
      const from = units.get(fromUnitId);
      const to = units.get(toUnitId);
      if (!from || !to) {
        throw new Error(`Unit ${!from ? fromUnitId : toUnitId} referenced by this recipe no longer exists`);
      }
      // RECIPE_PRECISION (8), not FR-01's default 3 — the result is divided by
      // the batch yield immediately afterwards.
      return convertUnitQuantity(quantity, from, to, RECIPE_PRECISION);
    };

    return { lookup: (recipeId) => loaded.get(recipeId), convert };
  }
}

const SCALE = 10n ** 8n;

/** Half-up rounding to 2dp on the scaled integer, returned as a decimal string. */
function round2(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const factor = SCALE / 100n;
  const rounded = (abs + factor / 2n) / factor;
  const whole = rounded / 100n;
  const cents = (rounded % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${cents}`;
}
