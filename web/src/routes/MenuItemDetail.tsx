import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ChefHat } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { NeedsYieldBadge } from '@/components/menu-items/NeedsYieldBadge';
import { RecipeLinesEditor, type DraftRecipeLine } from '@/components/menu-items/RecipeLinesEditor';
import {
  menuItemsApi,
  type ApiMenuItem,
  type ApiRecipe,
  type ApiRecipeCost,
  type ApiSubRecipeCandidate,
  type ApiUsedInEntry,
} from '@/lib/menu-items-api';
import { itemsApi, unitsApi, type ApiItem, type ApiUnitOfMeasure } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';

type Tab = 'recipe' | 'history' | 'usedIn';
const TABS: Tab[] = ['recipe', 'history', 'usedIn'];

/**
 * FR-05's Menu Item detail / Recipe builder.
 *
 * Saving always creates a new version — the API is create-or-replace and
 * never overwrites, because past sales stay costed against the version in
 * force when they happened. The screen says so on the button rather than
 * letting it be an invisible side effect.
 */
export function MenuItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [menuItem, setMenuItem] = useState<ApiMenuItem | null>(null);
  const [recipe, setRecipe] = useState<ApiRecipe | null>(null);
  const [history, setHistory] = useState<ApiRecipe[]>([]);
  const [cost, setCost] = useState<ApiRecipeCost | null>(null);
  const [usedIn, setUsedIn] = useState<ApiUsedInEntry[]>([]);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [units, setUnits] = useState<ApiUnitOfMeasure[]>([]);
  const [subRecipes, setSubRecipes] = useState<ApiSubRecipeCandidate[]>([]);
  const [subRecipeCosts, setSubRecipeCosts] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<Tab>('recipe');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * The version this edit is based on — `0` when there was no recipe yet.
   * Held separately from `recipe` so it is fixed at load time: it is the
   * precondition the save is checked against, and it must not drift as other
   * state changes.
   */
  const [baseVersion, setBaseVersion] = useState(0);

  // Draft state — seeded from the current version, since saving submits the
  // whole recipe, not a patch.
  const [yieldQuantity, setYieldQuantity] = useState('');
  const [yieldUnitId, setYieldUnitId] = useState('');
  const [lines, setLines] = useState<DraftRecipeLine[]>([]);

  const seedDraft = useCallback((current: ApiRecipe | null) => {
    setBaseVersion(current?.version ?? 0);
    setYieldQuantity(current?.yieldQuantity ?? '');
    setYieldUnitId(current?.yieldUnitId ?? '');
    setLines(
      (current?.lines ?? []).map((line) => ({
        kind: line.subRecipeId ? ('SUB_RECIPE' as const) : ('ITEM' as const),
        itemId: line.itemId ?? '',
        subRecipeId: line.subRecipeId ?? '',
        quantity: line.quantity,
        quantityUnitId: line.quantityUnitId ?? '',
      })),
    );
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await menuItemsApi.get(id);
      setMenuItem(loaded);
      // A menu item with no recipe yet is a normal state, so these are
      // allowed to fail individually without failing the screen.
      const current = await menuItemsApi.currentRecipe(id).catch(() => null);
      setRecipe(current);
      seedDraft(current);
      setHistory(await menuItemsApi.recipeHistory(id).catch(() => []));
      setCost(await menuItemsApi.cost(id).catch(() => null));
      setUsedIn(await menuItemsApi.usedIn(id).catch(() => []));
      setItems(await itemsApi.list({}).catch(() => []));
      setUnits(await unitsApi.list().catch(() => []));

      const candidates = await menuItemsApi
        .subRecipeCandidates(loaded.outletId, id)
        .catch(() => [] as ApiSubRecipeCandidate[]);
      setSubRecipes(candidates);
      // One cost per candidate, fetched once, so the live preview below can
      // price a sub-recipe line without a round trip per keystroke.
      const costs = await Promise.all(
        candidates.map((candidate) =>
          menuItemsApi
            .cost(candidate.menuItemId, candidate.version)
            .then((result) => [candidate.recipeId, result.totalCost] as const)
            .catch(() => null),
        ),
      );
      setSubRecipeCosts(Object.fromEntries(costs.filter((entry): entry is readonly [string, string] => !!entry)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menuItems.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, seedDraft, t]);

  useEffect(() => {
    load();
  }, [load]);

  const unitLabel = useCallback(
    (unitId: string | null) => units.find((unit) => unit.id === unitId)?.abbreviation ?? '',
    [units],
  );

  /**
   * Client-side cost preview, in the same spirit as GRN's `previewLineTax`:
   * the server always recomputes authoritatively on save. It is float
   * arithmetic here against the server's fixed-point maths, so the last cent
   * can differ — which is why it is labelled a preview and the saved figure
   * comes back from the API.
   */
  const lineCosts = useMemo(
    () =>
      lines.map((line) => {
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return null;

        if (line.kind === 'ITEM') {
          const item = items.find((candidate) => candidate.id === line.itemId);
          if (!item) return null;
          return (quantity * Number(item.costPrice)).toFixed(2);
        }

        const sub = subRecipes.find((candidate) => candidate.recipeId === line.subRecipeId);
        const subCost = sub ? subRecipeCosts[sub.recipeId] : undefined;
        if (!sub || subCost === undefined) return null;
        // Only exact when the line's unit is the child's own yield unit; a
        // converted unit needs the server's conversion table, so that case
        // shows nothing rather than a wrong number.
        if (line.quantityUnitId !== sub.yieldUnitId) return null;
        const batchFraction = quantity / Number(sub.yieldQuantity);
        return (batchFraction * Number(subCost)).toFixed(2);
      }),
    [lines, items, subRecipes, subRecipeCosts],
  );

  const previewTotal = useMemo(
    () => lineCosts.reduce((total, lineCost) => total + (lineCost ? Number(lineCost) : 0), 0).toFixed(2),
    [lineCosts],
  );

  // Derived from the loaded base, not from `menuItem.currentVersion`, so the
  // number on the button is the one the save will actually claim.
  const nextVersion = baseVersion + 1;
  const canSave = lines.length > 0 && !saving && !conflict;

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await menuItemsApi.saveRecipe(id, {
        yieldQuantity: yieldQuantity.trim() || undefined,
        yieldUnitId: yieldUnitId || undefined,
        basedOnVersion: baseVersion,
        lines: lines.map((line) =>
          line.kind === 'ITEM'
            ? { itemId: line.itemId, quantity: line.quantity }
            : {
                subRecipeId: line.subRecipeId,
                quantity: line.quantity,
                quantityUnitId: line.quantityUnitId || undefined,
              },
        ),
      });
      await load();
    } catch (err) {
      // 409 = someone else versioned this recipe first. Kept distinct from a
      // generic failure because the resolution is different: the edit can't
      // be retried as-is, it has to be reapplied on top of theirs. The typed
      // lines stay on screen so they can be copied across before reloading.
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setSaveError(err instanceof ApiError ? err.message : t('menuItems.builder.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function reloadAfterConflict() {
    setConflict(false);
    setSaveError(null);
    await load();
  }

  async function toggleActive() {
    if (!menuItem) return;
    setSaveError(null);
    try {
      const updated = menuItem.isActive
        ? await menuItemsApi.deactivate(menuItem.id)
        : await menuItemsApi.activate(menuItem.id);
      setMenuItem({ ...menuItem, isActive: updated.isActive });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('menuItems.builder.saveError'));
    }
  }

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

  const staleParents = usedIn.filter((entry) => entry.isStale);

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
            {recipe && <Badge variant="neutral">{t('menuItems.version', { version: recipe.version })}</Badge>}
            {cost && <Badge variant="neutral">{cost.totalCost}</Badge>}
            {menuItem.needsYield && <NeedsYieldBadge />}
          </div>
        </div>

        {/* Disabled rather than allowed-then-rejected: PATCH /activate 409s
            without a recipe, and the reason belongs on the control. */}
        <Button
          variant={menuItem.isActive ? 'outline' : 'primary'}
          onClick={toggleActive}
          disabled={!recipe && !menuItem.isActive}
          title={!recipe && !menuItem.isActive ? t('menuItems.builder.activateBlocked') : undefined}
        >
          {menuItem.isActive ? t('menuItems.builder.deactivate') : t('menuItems.builder.activate')}
        </Button>
      </div>

      {menuItem.needsYield && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('menuItems.needsYieldDetail')}
        </div>
      )}

      {/* FR-05's non-propagation rule, made visible instead of surprising. */}
      {staleParents.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-info">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('menuItems.builder.staleParents', { itemCount: staleParents.length })}</span>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            conflict
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          <span>{saveError}</span>
          {conflict && (
            <Button variant="outline" onClick={reloadAfterConflict}>
              {t('menuItems.builder.reloadRecipe')}
            </Button>
          )}
        </div>
      )}
      {conflict && (
        <p className="text-sm text-foreground-muted">{t('menuItems.builder.conflictHint')}</p>
      )}

      <div className="flex gap-1 border-b border-border">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t(`menuItems.tabs.${name}`)}
            {name === 'usedIn' && usedIn.length > 0 && <Badge variant="neutral">{usedIn.length}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'recipe' && (
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-base font-semibold text-foreground">
                {t('menuItems.builder.yieldTitle')}
              </h2>
              <p className="text-sm text-foreground-muted">{t('menuItems.builder.yieldHint')}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label={t('menuItems.builder.yieldQuantity')}
                  className="h-10 max-w-40 px-3 text-sm"
                  inputMode="decimal"
                  placeholder="0.0000"
                  value={yieldQuantity}
                  onChange={(e) => setYieldQuantity(e.target.value)}
                />
                <Select
                  aria-label={t('menuItems.builder.yieldUnit')}
                  className="h-10 max-w-40 px-3 text-sm"
                  value={yieldUnitId}
                  onChange={(e) => setYieldUnitId(e.target.value)}
                >
                  <option value="">{t('menuItems.builder.selectUnit')}</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.abbreviation}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="font-display text-base font-semibold text-foreground">
                {t('menuItems.builder.linesTitle')}
              </h2>
              <RecipeLinesEditor
                lines={lines}
                onChange={setLines}
                items={items}
                units={units}
                subRecipes={subRecipes}
                lineCosts={lineCosts}
                disabled={saving}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="text-sm text-foreground-muted">
                {t('menuItems.builder.previewTotal', { total: previewTotal })}
              </div>
              <div className="flex items-center gap-3">
                {/* The versioning rule, stated on the control that triggers it. */}
                <span className="text-sm text-foreground-muted">
                  {t('menuItems.builder.willCreateVersion', { version: nextVersion })}
                </span>
                <Button onClick={handleSave} disabled={!canSave}>
                  {saving
                    ? t('menuItems.saving')
                    : t('menuItems.builder.saveAsVersion', { version: nextVersion })}
                </Button>
              </div>
            </div>
            {lines.length === 0 && (
              <p className="text-sm text-foreground-muted">{t('menuItems.builder.needsALine')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-foreground-muted">{t('menuItems.builder.historyHint')}</p>
            {history.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('menuItems.noRecipe')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {history.map((version) => (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="flex items-center gap-2">
                      {t('menuItems.version', { version: version.version })}
                      {version.isCurrent && <Badge variant="primary">{t('menuItems.current')}</Badge>}
                    </span>
                    <span className="text-sm text-foreground-muted">
                      {version.yieldQuantity
                        ? t('menuItems.yields', {
                            quantity: version.yieldQuantity,
                            unit: unitLabel(version.yieldUnitId),
                          })
                        : t('menuItems.noYield')}
                      {' · '}
                      {t('menuItems.builder.lineCount', { lineCount: version.lines.length })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'usedIn' && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-foreground-muted">{t('menuItems.builder.usedInHint')}</p>
            {usedIn.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('menuItems.builder.usedInEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {usedIn.map((entry) => (
                  <li
                    key={entry.parentRecipeId}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <Link
                      to={`/menu-items/${entry.parentMenuItemId}`}
                      className="text-sm font-medium text-accent-blue hover:underline"
                    >
                      {entry.parentMenuItemName}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-foreground-muted">
                      {t('menuItems.builder.pinsVersion', { version: entry.referencedVersion })}
                      {entry.isStale && (
                        <Badge variant="warning">{t('menuItems.builder.olderVersion')}</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
