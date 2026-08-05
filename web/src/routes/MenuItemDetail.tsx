import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChefHat } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { NeedsYieldBadge } from '@/components/menu-items/NeedsYieldBadge';
import {
  menuItemsApi,
  type ApiMenuItem,
  type ApiRecipe,
  type ApiRecipeCost,
} from '@/lib/menu-items-api';
import { itemsApi, unitsApi, type ApiItem, type ApiUnitOfMeasure } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';


/**
 * FR-05's recipe, read-only, with FR-06's "Needs yield" indicator. Read-only
 * deliberately: FR-05 shipped its own create/version endpoints but no screen,
 * and inventing a full recipe *builder* here would be a second FR's worth of
 * UI smuggled into FR-06. This is what the Unmapped Items worklist links to
 * and where the badge lives; editing stays on the backend API for now.
 */
export function MenuItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [menuItem, setMenuItem] = useState<ApiMenuItem | null>(null);
  const [recipe, setRecipe] = useState<ApiRecipe | null>(null);
  const [history, setHistory] = useState<ApiRecipe[]>([]);
  const [cost, setCost] = useState<ApiRecipeCost | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [units, setUnits] = useState<ApiUnitOfMeasure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setMenuItem(await menuItemsApi.get(id));
      // A menu item with no recipe yet is a normal state (FR-05 creates them
      // unsellable and recipe-less), so these three are allowed to fail
      // individually without failing the screen.
      setRecipe(await menuItemsApi.currentRecipe(id).catch(() => null));
      setHistory(await menuItemsApi.recipeHistory(id).catch(() => []));
      setCost(await menuItemsApi.cost(id).catch(() => null));
      // Both are already scoped server-side to the caller's outlets; they're
      // fetched only to turn the recipe's item/unit ids into readable names.
      setItems(await itemsApi.list({}).catch(() => []));
      setUnits(await unitsApi.list().catch(() => []));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menuItems.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const itemName = (itemId: string) => items.find((item) => item.id === itemId)?.name ?? itemId;
  const unitLabel = (unitId: string | null) =>
    unitId ? (units.find((unit) => unit.id === unitId)?.abbreviation ?? '') : '';

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !menuItem) {
    return (
      <EmptyState
        icon={<ChefHat className="h-7 w-7" />}
        title={t('menuItems.loadError')}
        description={error ?? ''}
        action={<Button onClick={load}>{t('common.refresh')}</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/menu-items')}
            className="mb-2 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('menuItems.backToList')}
          </button>
          <h1 className="font-display text-xl font-semibold text-foreground">{menuItem.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={menuItem.isActive ? 'success' : 'neutral'}>
              {menuItem.isActive ? t('menuItems.status.active') : t('menuItems.status.inactive')}
            </Badge>
            {menuItem.needsYield && <NeedsYieldBadge />}
          </div>
        </div>
      </div>

      {menuItem.needsYield && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('menuItems.needsYieldDetail')}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t('menuItems.currentRecipe')}
            </h2>
            {recipe && (
              <span className="text-sm text-foreground-muted">
                {t('menuItems.version', { version: recipe.version })}
                {recipe.yieldQuantity
                  ? ` · ${t('menuItems.yields', {
                      quantity: recipe.yieldQuantity,
                      unit: unitLabel(recipe.yieldUnitId),
                    })}`
                  : ''}
              </span>
            )}
          </div>

          {!recipe ? (
            <p className="text-sm text-foreground-muted">{t('menuItems.noRecipe')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="py-2">{t('menuItems.columns.ingredient')}</th>
                  <th className="py-2">{t('menuItems.columns.quantity')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recipe.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2">
                      {line.itemId ? (
                        itemName(line.itemId)
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {t('menuItems.subRecipe')}
                          <Badge variant="info">{t('menuItems.nested')}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {line.quantity} {unitLabel(line.quantityUnitId)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {cost && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-foreground">
                {t('menuItems.cost')}
              </h2>
              <span className="font-medium">{cost.totalCost}</span>
            </div>
            {cost.usesLegacyBatchMultiplier && (
              <p className="text-sm text-warning">{t('menuItems.costApproximate')}</p>
            )}
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {cost.components.map((component) => (
                  <tr key={component.itemId}>
                    <td className="py-2">{component.itemName}</td>
                    <td className="py-2 text-foreground-muted">
                      {component.quantity} {unitLabel(component.unitId)}
                    </td>
                    <td className="py-2 text-end">{component.lineCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {history.length > 1 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t('menuItems.versionHistory')}
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {history.map((version) => (
                <li key={version.id} className="flex items-center justify-between gap-3">
                  <span>{t('menuItems.version', { version: version.version })}</span>
                  <span className="flex items-center gap-2 text-foreground-muted">
                    {version.yieldQuantity
                      ? t('menuItems.yields', {
                          quantity: version.yieldQuantity,
                          unit: unitLabel(version.yieldUnitId),
                        })
                      : t('menuItems.noYield')}
                    {version.isCurrent && <Badge variant="primary">{t('menuItems.current')}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
