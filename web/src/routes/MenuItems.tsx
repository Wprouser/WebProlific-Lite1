import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChefHat, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { NeedsYieldBadge } from '@/components/menu-items/NeedsYieldBadge';
import { menuItemsApi, type ApiMenuItem } from '@/lib/menu-items-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * FR-05's Menu Item list: name, status, current recipe version, computed
 * cost, and the two yield-related badges.
 *
 * Costs are requested explicitly (`includeCost`) because each one is a full
 * recipe-tree resolution server-side. This screen is the place that actually
 * shows them, so it pays; nothing else should.
 */
export function MenuItems() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<ApiMenuItem[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      setMenuItems(
        await menuItemsApi.list({ outletId, search: search || undefined, includeCost: true }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menuItems.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, search, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!outletId || !newName.trim()) return;
    setSaving(true);
    setCreateError(null);
    try {
      const created = await menuItemsApi.create({ outletId, name: newName.trim() });
      // Straight into the builder — a menu item with no recipe is unsellable,
      // so creating one and stopping there is never the finished job.
      navigate(`/menu-items/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('menuItems.createError'));
    } finally {
      setSaving(false);
    }
  }

  const needsYieldCount = menuItems.filter((menuItem) => menuItem.needsYield).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('menuItems.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('menuItems.subtitle')}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          {t('menuItems.addNew')}
        </Button>
      </div>

      {needsYieldCount > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('menuItems.needsYieldSummary', { itemCount: needsYieldCount })}
        </div>
      )}

      <Input
        className="max-w-sm"
        placeholder={t('menuItems.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<ChefHat className="h-7 w-7" />}
          title={t('menuItems.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : menuItems.length === 0 ? (
        <EmptyState
          icon={<ChefHat className="h-7 w-7" />}
          title={t('menuItems.empty.title')}
          description={t('menuItems.empty.description')}
          action={<Button onClick={() => setCreating(true)}>{t('menuItems.addNew')}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">{t('menuItems.columns.name')}</th>
                <th className="px-4 py-3">{t('menuItems.columns.version')}</th>
                <th className="px-4 py-3">{t('menuItems.columns.cost')}</th>
                <th className="px-4 py-3">{t('menuItems.columns.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {menuItems.map((menuItem) => (
                <tr
                  key={menuItem.id}
                  className="cursor-pointer hover:bg-surface-secondary/40"
                  onClick={() => navigate(`/menu-items/${menuItem.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{menuItem.name}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {menuItem.currentVersion === null
                      ? t('menuItems.noRecipeShort')
                      : t('menuItems.version', { version: menuItem.currentVersion })}
                  </td>
                  <td className="px-4 py-3">
                    {menuItem.totalCost ?? '—'}
                    {menuItem.costUsesLegacyRecipe && (
                      <span className="ms-1.5 text-xs text-foreground-muted" title={t('menuItems.costApproximate')}>
                        ≈
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={menuItem.isActive ? 'success' : 'neutral'}>
                        {menuItem.isActive ? t('menuItems.status.active') : t('menuItems.status.inactive')}
                      </Badge>
                      {menuItem.needsYield && <NeedsYieldBadge />}
                      {menuItem.costUsesLegacyRecipe && !menuItem.needsYield && (
                        <Badge variant="neutral" title={t('menuItems.costApproximate')}>
                          {t('menuItems.costApproximateBadge')}
                        </Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) {
            setNewName('');
            setCreateError(null);
          }
        }}
        title={t('menuItems.addNew')}
        description={t('menuItems.addNewDescription')}
      >
        <form className="flex flex-col gap-4" onSubmit={handleCreate}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="menu-item-name" className="text-sm font-medium text-foreground">
              {t('menuItems.columns.name')}
            </label>
            <Input
              id="menu-item-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          {createError && (
            <p role="alert" className="text-sm text-danger">
              {createError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              {t('menuItems.cancel')}
            </Button>
            <Button type="submit" disabled={!newName.trim() || saving}>
              {saving ? t('menuItems.saving') : t('menuItems.createAndBuild')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
