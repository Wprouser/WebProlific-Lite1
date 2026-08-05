import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChefHat } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { NeedsYieldBadge } from '@/components/menu-items/NeedsYieldBadge';
import { menuItemsApi, type ApiMenuItem } from '@/lib/menu-items-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * FR-05's menu items, listed. Built as part of FR-06 because two of its
 * acceptance criteria need somewhere to land: the "Needs yield" badge, and
 * the Unmapped Items worklist's link to "that menu item's recipe screen".
 */
export function MenuItems() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<ApiMenuItem[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      setMenuItems(await menuItemsApi.list({ outletId, search: search || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menuItems.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, search, t]);

  useEffect(() => {
    load();
  }, [load]);

  const needsYieldCount = menuItems.filter((menuItem) => menuItem.needsYield).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('menuItems.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('menuItems.subtitle')}</p>
        </div>
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
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">{t('menuItems.columns.name')}</th>
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
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={menuItem.isActive ? 'success' : 'neutral'}>
                        {menuItem.isActive ? t('menuItems.status.active') : t('menuItems.status.inactive')}
                      </Badge>
                      {menuItem.needsYield && <NeedsYieldBadge />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
