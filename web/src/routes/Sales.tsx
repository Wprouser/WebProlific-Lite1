import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Receipt, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  salesApi,
  type ApiSale,
  type ApiUnmappedMenuItem,
  type SaleSourceType,
} from '@/lib/sales-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

type Tab = 'sales' | 'unmapped';

const SOURCE_VARIANT: Record<SaleSourceType, 'info' | 'primary' | 'neutral'> = {
  WEBHOOK: 'info',
  BATCH_IMPORT: 'primary',
  MANUAL: 'neutral',
};

/**
 * FR-06's home screen. Two tabs rather than two routes for the list itself:
 * the Unmapped worklist is a view of the same sales data, and the tab is the
 * thing that makes it discoverable. It still has its own URL
 * (`/sales?tab=unmapped`) so the batch-run summary and the nav can link
 * straight at it.
 */
export function Sales() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const tab: Tab = searchParams.get('tab') === 'unmapped' ? 'unmapped' : 'sales';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<ApiSale[]>([]);
  const [unmapped, setUnmapped] = useState<ApiUnmappedMenuItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'' | SaleSourceType>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'unmapped') {
        setUnmapped(await salesApi.listUnmapped(outletId));
      } else {
        setSales(await salesApi.list({ outletId, sourceType: sourceFilter || undefined }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sales.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, sourceFilter, tab, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Loaded regardless of the active tab, so the count on the Unmapped tab is
  // visible without having to open it — the point of a worklist is that it
  // nags.
  const [unmappedCount, setUnmappedCount] = useState(0);
  useEffect(() => {
    salesApi
      .listUnmapped(outletId)
      .then((rows) => setUnmappedCount(rows.length))
      .catch(() => setUnmappedCount(0));
  }, [outletId, sales]);

  function selectTab(next: Tab) {
    setSearchParams(next === 'unmapped' ? { tab: 'unmapped' } : {});
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('sales.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('sales.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/sales/import')}>
          <Upload className="h-4 w-4" />
          {t('sales.importDaily')}
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['sales', 'unmapped'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => selectTab(name)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t(`sales.tabs.${name}`)}
            {name === 'unmapped' && unmappedCount > 0 && (
              <Badge variant="warning">{unmappedCount}</Badge>
            )}
          </button>
        ))}
      </div>

      {tab === 'sales' && (
        <Select
          className="w-auto min-w-48"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as '' | SaleSourceType)}
        >
          <option value="">{t('sales.filters.allSources')}</option>
          <option value="WEBHOOK">{t('sales.source.WEBHOOK')}</option>
          <option value="BATCH_IMPORT">{t('sales.source.BATCH_IMPORT')}</option>
          <option value="MANUAL">{t('sales.source.MANUAL')}</option>
        </Select>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<Receipt className="h-7 w-7" />}
          title={t('sales.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : tab === 'unmapped' ? (
        <UnmappedTable rows={unmapped} />
      ) : (
        <SalesTable rows={sales} />
      )}
    </div>
  );
}

function SalesTable({ rows }: { rows: ApiSale[] }) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="h-7 w-7" />}
        title={t('sales.empty.title')}
        description={t('sales.empty.description')}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          <tr>
            <th className="px-4 py-3">{t('sales.columns.menuItem')}</th>
            <th className="px-4 py-3">{t('sales.columns.quantity')}</th>
            <th className="px-4 py-3">{t('sales.columns.source')}</th>
            <th className="px-4 py-3">{t('sales.columns.date')}</th>
            <th className="px-4 py-3">{t('sales.columns.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((sale) => (
            <tr key={sale.id} className={sale.isVoid ? 'opacity-60' : undefined}>
              <td className="px-4 py-3 font-medium">{sale.menuItemName}</td>
              <td className="px-4 py-3">{sale.quantitySold}</td>
              <td className="px-4 py-3">
                <Badge variant={SOURCE_VARIANT[sale.sourceType]}>{t(`sales.source.${sale.sourceType}`)}</Badge>
              </td>
              <td className="px-4 py-3 text-foreground-muted">
                {new Date(sale.saleTimestamp).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {sale.isVoid && <Badge variant="danger">{t('sales.voided')}</Badge>}
                  {sale.recipeVersionUsed === null ? (
                    <Badge variant="warning">{t('sales.notDeducted')}</Badge>
                  ) : (
                    <Badge variant="neutral">
                      {t('menuItems.version', { version: sale.recipeVersionUsed })}
                    </Badge>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnmappedTable({ rows }: { rows: ApiUnmappedMenuItem[] }) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="h-7 w-7" />}
        title={t('sales.unmapped.empty.title')}
        description={t('sales.unmapped.empty.description')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">{t('sales.unmapped.explainer')}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">{t('sales.columns.menuItem')}</th>
              <th className="px-4 py-3">{t('sales.unmapped.columns.saleCount')}</th>
              <th className="px-4 py-3">{t('sales.unmapped.columns.totalSold')}</th>
              <th className="px-4 py-3">{t('sales.unmapped.columns.lastSold')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.menuItemId}>
                <td className="px-4 py-3 font-medium">{row.menuItemName}</td>
                <td className="px-4 py-3">{row.saleCount}</td>
                <td className="px-4 py-3">{row.totalQuantitySold}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {new Date(row.lastSoldAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-end">
                  {/* The whole point of the worklist: one click from "this
                      wasn't deducted" to the screen where it gets fixed. */}
                  <Link
                    to={`/menu-items/${row.menuItemId}`}
                    className="text-sm font-medium text-accent-blue hover:underline"
                  >
                    {t('sales.unmapped.addRecipe')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
