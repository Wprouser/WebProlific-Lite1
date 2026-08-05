import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { ApiItem, ApiUnitOfMeasure } from '@/lib/items-api';
import type { ApiSubRecipeCandidate } from '@/lib/menu-items-api';
import { cn } from '@/lib/cn';

/** One line being edited. `kind` is UI-only — the API expresses the same
 * thing as "exactly one of itemId / subRecipeId is set". */
export interface DraftRecipeLine {
  kind: 'ITEM' | 'SUB_RECIPE';
  itemId: string;
  subRecipeId: string;
  quantity: string;
  quantityUnitId: string;
}

export function emptyLine(kind: DraftRecipeLine['kind'] = 'ITEM'): DraftRecipeLine {
  return { kind, itemId: '', subRecipeId: '', quantity: '', quantityUnitId: '' };
}

interface RecipeLinesEditorProps {
  lines: DraftRecipeLine[];
  onChange: (lines: DraftRecipeLine[]) => void;
  items: ApiItem[];
  units: ApiUnitOfMeasure[];
  subRecipes: ApiSubRecipeCandidate[];
  /** Per-line cost, index-aligned with `lines`. A preview only — the server
   * recomputes authoritatively on save. */
  lineCosts: (string | null)[];
  disabled?: boolean;
}

const compactField = 'h-10 px-3 text-sm';

/**
 * FR-05's recipe builder lines. Each line is either a raw ingredient
 * (quantity in the item's own stocking unit, no unit picker — that's what
 * the spec means by "implicitly in the item's unit") or a sub-recipe
 * (quantity plus an explicit unit, because "0.2 kg of sauce" needs to say
 * kg).
 *
 * The sub-recipe dropdown is fed only from yield-bearing candidates, so the
 * yield-less case the server rejects with a 409 is never offerable here.
 */
export function RecipeLinesEditor({
  lines,
  onChange,
  items,
  units,
  subRecipes,
  lineCosts,
  disabled,
}: RecipeLinesEditorProps) {
  const { t } = useTranslation();

  function update(index: number, patch: Partial<DraftRecipeLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function unitLabel(unitId: string | null): string {
    return units.find((unit) => unit.id === unitId)?.abbreviation ?? '';
  }

  /** Units a sub-recipe line may use: those sharing a base with the child's
   * yield unit. Offering an unrelated family would only earn a 400. */
  function compatibleUnits(subRecipeId: string): ApiUnitOfMeasure[] {
    const candidate = subRecipes.find((sub) => sub.recipeId === subRecipeId);
    if (!candidate) return units;
    const yieldUnit = units.find((unit) => unit.id === candidate.yieldUnitId);
    if (!yieldUnit) return units;
    const familyOf = (unit: ApiUnitOfMeasure) => unit.baseUnitId ?? unit.id;
    const family = familyOf(yieldUnit);
    return units.filter((unit) => familyOf(unit) === family);
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('menuItems.builder.noLines')}</p>
      )}

      {lines.map((line, index) => {
        const selectedItem = items.find((item) => item.id === line.itemId);
        const cost = lineCosts[index];

        return (
          <div
            key={index}
            className="grid grid-cols-[10rem_2fr_1fr_1fr_auto_auto] items-start gap-2"
          >
            <Select
              aria-label={t('menuItems.builder.lineType', { line: index + 1 })}
              className={compactField}
              value={line.kind}
              disabled={disabled}
              onChange={(e) =>
                // Reset the other side's selection: keeping a stale itemId on
                // a line that is now a sub-recipe would submit both, which the
                // server rejects as "exactly one of".
                update(index, { ...emptyLine(e.target.value as DraftRecipeLine['kind']), quantity: line.quantity })
              }
            >
              <option value="ITEM">{t('menuItems.builder.rawIngredient')}</option>
              <option value="SUB_RECIPE">{t('menuItems.subRecipe')}</option>
            </Select>

            {line.kind === 'ITEM' ? (
              <Select
                aria-label={t('menuItems.builder.ingredientFor', { line: index + 1 })}
                className={compactField}
                value={line.itemId}
                disabled={disabled}
                onChange={(e) => update(index, { itemId: e.target.value })}
              >
                <option value="">{t('menuItems.builder.selectIngredient')}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                aria-label={t('menuItems.builder.subRecipeFor', { line: index + 1 })}
                className={compactField}
                value={line.subRecipeId}
                disabled={disabled}
                onChange={(e) => update(index, { subRecipeId: e.target.value, quantityUnitId: '' })}
              >
                <option value="">{t('menuItems.builder.selectSubRecipe')}</option>
                {subRecipes.map((sub) => (
                  <option key={sub.recipeId} value={sub.recipeId}>
                    {sub.menuItemName} (v{sub.version}) — {t('menuItems.yields', {
                      quantity: sub.yieldQuantity,
                      unit: unitLabel(sub.yieldUnitId),
                    })}
                  </option>
                ))}
              </Select>
            )}

            <Input
              aria-label={t('menuItems.builder.quantityFor', { line: index + 1 })}
              className={compactField}
              inputMode="decimal"
              placeholder="0.0000"
              value={line.quantity}
              disabled={disabled}
              onChange={(e) => update(index, { quantity: e.target.value })}
            />

            {line.kind === 'ITEM' ? (
              // No picker: a raw-ingredient quantity is always in the item's
              // own stocking unit, so showing it as text avoids implying a
              // choice that doesn't exist.
              <span className="pt-2 text-sm text-foreground-muted">
                {selectedItem ? unitLabel(selectedItem.unitId) : '—'}
              </span>
            ) : (
              <Select
                aria-label={t('menuItems.builder.unitFor', { line: index + 1 })}
                className={compactField}
                value={line.quantityUnitId}
                disabled={disabled || !line.subRecipeId}
                onChange={(e) => update(index, { quantityUnitId: e.target.value })}
              >
                <option value="">{t('menuItems.builder.selectUnit')}</option>
                {compatibleUnits(line.subRecipeId).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.abbreviation}
                  </option>
                ))}
              </Select>
            )}

            <span className={cn('pt-2 text-sm', cost ? 'font-medium text-foreground' : 'text-foreground-muted')}>
              {cost ?? '—'}
            </span>

            <Button
              type="button"
              variant="ghost"
              className="h-10 w-10 p-0"
              aria-label={t('menuItems.builder.removeLine', { line: index + 1 })}
              disabled={disabled}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <div>
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => onChange([...lines, emptyLine()])}>
          {t('menuItems.builder.addLine')}
        </Button>
      </div>
    </div>
  );
}
