import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MENU_ITEM_REPOSITORY, RECIPE_REPOSITORY } from '../../recipes/repositories/tokens';
import { MenuItemRepository } from '../../recipes/repositories/menu-item.repository';
import { RecipeRepository } from '../../recipes/repositories/recipe.repository';
import { RecipeCostService, ResolvedRecipeVersion } from '../../recipes/services/recipe-cost.service';
import { fromScaled, toScaled } from '../../recipes/lib/resolve-recipe-tree';
import { ITEM_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { StockTransactionsService } from '../../stock-transactions/services/stock-transactions.service';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';
import { SALE_REPOSITORY } from '../repositories/tokens';
import { SaleRepository } from '../repositories/sale.repository';
import { Sale } from '../domain/sale.entity';
import { SALE_WARNING_ACTIONS, SaleSourceType, SaleWarningAction } from '../constants/enums';

export interface RecordSaleInput {
  outletId: string;
  menuItemId: string;
  /** Portions sold, Decimal(10,3). */
  quantitySold: string;
  posReferenceId: string;
  sourceType: SaleSourceType;
  importBatchId?: string | null;
  saleTimestamp: Date;
}

export interface SaleWarning {
  action: SaleWarningAction;
  message: string;
  /** The recipe or item the warning is actionable against, when there is one. */
  recipeId?: string;
  itemId?: string;
}

export interface RecordSaleResult {
  sale: Sale;
  /** True when this posReferenceId had already been recorded — nothing was
   * deducted a second time. */
  alreadyProcessed: boolean;
  deducted: boolean;
  warnings: SaleWarning[];
}

export interface ProjectedIngredientImpact {
  itemId: string;
  itemName: string;
  unitId: string;
  /** Total to be deducted across every row this projection covers. */
  quantity: string;
  currentStock: string;
  /** currentStock - quantity. Negative means this batch would oversell. */
  projectedStock: string;
}

/**
 * FR-06's single deduction path.
 *
 * Every integration model — live webhook, reviewed batch import, manual
 * entry — lands here, which is the spec's own requirement ("sharing the
 * exact same underlying deduction logic ... the only difference is how a
 * Sale record gets created"). Keeping that literally true is why the caller
 * passes a `sourceType` rather than each caller owning its own copy of the
 * resolve-and-deduct sequence.
 *
 * The governing rule throughout: **a sale that really happened gets
 * recorded**. Every condition that would traditionally abort — no recipe, a
 * yield-less sub-recipe, not enough stock, a deleted ingredient — instead
 * records what it can and raises a visible warning. Refusing the sale would
 * not undo it in the restaurant; it would only make the books disagree with
 * reality more quietly.
 */
@Injectable()
export class SaleDeductionService {
  private readonly logger = new Logger(SaleDeductionService.name);

  constructor(
    @Inject(SALE_REPOSITORY) private readonly saleRepository: SaleRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(RECIPE_REPOSITORY) private readonly recipeRepository: RecipeRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    private readonly recipeCostService: RecipeCostService,
    private readonly stockTransactionsService: StockTransactionsService,
    private readonly activityBus: ActivityBus,
  ) {}

  async recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
    const menuItem = await this.menuItemRepository.findById(input.menuItemId);
    if (!menuItem) throw new NotFoundException(`Menu item ${input.menuItemId} not found`);

    const resolved = await this.tryResolveCurrentRecipe(input.menuItemId);

    // Insert first, so the Sale id is available as the StockTransaction
    // reference — and so a replay is detected before any stock moves.
    const { sale, created } = await this.saleRepository.createIfAbsent({
      outletId: menuItem.outletId,
      menuItemId: input.menuItemId,
      quantitySold: input.quantitySold,
      recipeVersionUsed: resolved?.recipeVersion ?? null,
      posReferenceId: input.posReferenceId,
      sourceType: input.sourceType,
      importBatchId: input.importBatchId ?? null,
      saleTimestamp: input.saleTimestamp,
    });

    if (!created) {
      return { sale, alreadyProcessed: true, deducted: false, warnings: [] };
    }

    if (!resolved) {
      const warning: SaleWarning = {
        action: SALE_WARNING_ACTIONS.RECIPE_MISSING,
        message: `"${menuItem.name}" was sold but has no recipe, so no ingredients were deducted.`,
      };
      await this.emitWarning(menuItem.outletId, input.menuItemId, warning, {
        saleId: sale.id,
        quantitySold: input.quantitySold,
      });
      return { sale, alreadyProcessed: false, deducted: false, warnings: [warning] };
    }

    const warnings = await this.deductIngredients(sale, menuItem.outletId, input.quantitySold, resolved);
    await this.warnAboutLegacyRecipes(menuItem.outletId, resolved, sale, warnings);

    return { sale, alreadyProcessed: false, deducted: true, warnings };
  }

  /**
   * Reverses a sale by replaying the movements it actually wrote, negated.
   *
   * Deliberately *not* a re-resolution of the recipe: FR-05 lets a recipe be
   * re-versioned at any time, and re-resolving would reverse quantities that
   * were never deducted whenever a sale is voided after a recipe edit. The
   * StockTransaction rows are the record of what left the shelf, so they are
   * what comes back.
   */
  async voidSale(sale: Sale): Promise<{ sale: Sale; reversedCount: number }> {
    const original = await this.stockTransactionsService.findByReference('SALE', sale.id);

    for (const transaction of original) {
      // Only the deductions are reversed. Re-voiding is prevented by the
      // isVoid check in the caller, but skipping ADJUSTMENT_IN rows here
      // keeps this correct even if a reversal were ever replayed.
      if (transaction.type !== 'USAGE_OUT') continue;
      await this.stockTransactionsService.createSystem({
        itemId: transaction.itemId,
        type: 'ADJUSTMENT_IN',
        quantity: transaction.quantity,
        referenceType: 'SALE',
        referenceId: sale.id,
        descriptionKey: 'activity.sale.voided',
        metadata: { saleId: sale.id, reversalOf: transaction.id },
      });
    }

    const voided = await this.saleRepository.markVoided(sale.id, new Date());
    return { sale: voided, reversedCount: original.filter((t) => t.type === 'USAGE_OUT').length };
  }

  /**
   * What a set of sales *would* deduct, without deducting anything.
   *
   * This is the batch-import Review screen's impact preview. It has to be
   * computed server-side: projecting the impact means resolving each menu
   * item's full recipe tree (including nested sub-recipes and unit
   * conversions), which the browser has neither the data nor the arithmetic
   * for. Menu items with no recipe simply contribute nothing, matching what
   * running the batch would actually do.
   */
  async projectImpact(
    lines: { menuItemId: string; quantitySold: string }[],
  ): Promise<{ impact: ProjectedIngredientImpact[]; unresolvableMenuItemIds: string[] }> {
    const totals = new Map<string, bigint>();
    const unresolvable: string[] = [];

    for (const line of lines) {
      const resolved = await this.tryResolveCurrentRecipe(line.menuItemId);
      if (!resolved) {
        if (!unresolvable.includes(line.menuItemId)) unresolvable.push(line.menuItemId);
        continue;
      }
      for (const ingredient of resolved.ingredients) {
        const contribution = this.scaleForSale(ingredient.quantity, line.quantitySold);
        totals.set(ingredient.itemId, (totals.get(ingredient.itemId) ?? 0n) + contribution);
      }
    }

    const impact: ProjectedIngredientImpact[] = [];
    for (const [itemId, scaled] of totals) {
      const item = await this.itemRepository.findById(itemId);
      if (!item) continue;
      const quantity = roundTo3(scaled);
      impact.push({
        itemId,
        itemName: item.name,
        unitId: item.unitId,
        quantity,
        currentStock: item.currentStock,
        projectedStock: fromScaled(toScaled(item.currentStock) - toScaled(quantity)),
      });
    }

    impact.sort((a, b) => a.itemName.localeCompare(b.itemName));
    return { impact, unresolvableMenuItemIds: unresolvable };
  }

  /** Null rather than throwing when there's simply no recipe yet — that is a
   * routine state here, not an error, and the caller records the sale either
   * way. Any *other* resolution failure (a cycle, a deleted ingredient) is
   * still a real fault and propagates. */
  private async tryResolveCurrentRecipe(menuItemId: string): Promise<ResolvedRecipeVersion | null> {
    const current = await this.recipeRepository.findCurrentByMenuItemId(menuItemId);
    if (!current) return null;
    return this.recipeCostService.resolveRecipeVersion(menuItemId);
  }

  private async deductIngredients(
    sale: Sale,
    outletId: string,
    quantitySold: string,
    resolved: ResolvedRecipeVersion,
  ): Promise<SaleWarning[]> {
    const warnings: SaleWarning[] = [];

    for (const ingredient of resolved.ingredients) {
      const quantity = roundTo3(this.scaleForSale(ingredient.quantity, quantitySold));

      // Below the stock ledger's declared Decimal(10,3) resolution — e.g. a
      // pinch of saffron on a single portion. Not a data problem anyone can
      // fix, so it's skipped rather than warned about; deducting 0.000 would
      // just write an empty row.
      if (Number(quantity) <= 0) continue;

      try {
        const { wentNegative } = await this.stockTransactionsService.createSystem({
          itemId: ingredient.itemId,
          type: 'USAGE_OUT',
          quantity,
          referenceType: 'SALE',
          referenceId: sale.id,
          descriptionKey: 'activity.sale.deducted',
          metadata: { saleId: sale.id, menuItemId: sale.menuItemId, quantitySold },
        });

        if (wentNegative) {
          const warning: SaleWarning = {
            action: SALE_WARNING_ACTIONS.NEGATIVE_STOCK_ON_SALE,
            message: `Deducting ${quantity} for this sale took an ingredient below zero — recorded stock was already short.`,
            itemId: ingredient.itemId,
          };
          warnings.push(warning);
          await this.emitWarning(outletId, sale.menuItemId, warning, { saleId: sale.id, itemId: ingredient.itemId });
        }
      } catch (error) {
        // One broken ingredient (deleted item, say) must not cost the other
        // ingredients their deduction, nor fail the webhook.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Sale ${sale.id}: failed to deduct item ${ingredient.itemId}: ${message}`);
        const warning: SaleWarning = {
          action: SALE_WARNING_ACTIONS.NEGATIVE_STOCK_ON_SALE,
          message: `An ingredient could not be deducted for this sale: ${message}`,
          itemId: ingredient.itemId,
        };
        warnings.push(warning);
        await this.emitWarning(outletId, sale.menuItemId, warning, { saleId: sale.id, itemId: ingredient.itemId });
      }
    }

    return warnings;
  }

  /**
   * The visible half of "never block the webhook": a sale that deducted
   * through a yield-less sub-recipe still deducted, but imprecisely, and the
   * warning names the recipe so it becomes a maintenance worklist item
   * rather than a silent drift.
   */
  private async warnAboutLegacyRecipes(
    outletId: string,
    resolved: ResolvedRecipeVersion,
    sale: Sale,
    warnings: SaleWarning[],
  ): Promise<void> {
    for (const recipeId of resolved.legacyRecipeIds) {
      const recipe = await this.recipeRepository.findById(recipeId);
      const owner = recipe ? await this.menuItemRepository.findById(recipe.menuItemId) : null;
      const label = owner ? `"${owner.name}" (v${recipe!.version})` : `recipe ${recipeId}`;

      const warning: SaleWarning = {
        action: SALE_WARNING_ACTIONS.LEGACY_RECIPE_DEDUCTION,
        message: `Stock was deducted through ${label}, which has no yield set — the quantity was read as a batch multiplier and is approximate. Set a yield on that recipe to make it exact.`,
        recipeId,
      };
      warnings.push(warning);
      // Recorded against the sub-recipe's OWN menu item, not the dish that
      // was sold: that is the row a user has to open to fix it, and it is
      // what makes the "Needs yield" badge and this warning point at the
      // same place.
      await this.emitWarning(outletId, recipe?.menuItemId ?? sale.menuItemId, warning, {
        saleId: sale.id,
        soldMenuItemId: sale.menuItemId,
        recipeId,
      });
    }
  }

  /** ingredientQuantity x portionsSold, in scaled fixed-point. */
  private scaleForSale(ingredientQuantity: string, quantitySold: string): bigint {
    return (toScaled(ingredientQuantity) * toScaled(quantitySold)) / SCALE;
  }

  private async emitWarning(
    outletId: string,
    menuItemId: string,
    warning: SaleWarning,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.activityBus.record({
      // FR-18's ActivityCategory list has no WARNING bucket; ALERT is the
      // established "needs a human's attention" category.
      category: 'ALERT',
      action: warning.action,
      entityType: 'MenuItem',
      entityId: menuItemId,
      outletId,
      descriptionKey: `activity.sale.${warning.action.toLowerCase()}`,
      metadata: { ...metadata, message: warning.message },
    });
  }
}

const SCALE = 10n ** 8n;

/** Half-up rounding to the stock ledger's 3dp, as a decimal string. */
function roundTo3(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const factor = SCALE / 1000n;
  const rounded = ((abs + factor / 2n) / factor) * factor;
  return `${negative ? '-' : ''}${fromScaled(rounded)}`;
}
