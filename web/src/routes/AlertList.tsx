import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { alertsApi, type AlertType, type ApiAlert } from '@/lib/alerts-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * Destination for Global Alert Bar clicks (FR-17 AC: "navigates directly to
 * the correctly filtered underlying list, not a generic alerts page
 * requiring further filtering"). Real now that FR-07 exists.
 *
 * Two of the bar's five badges were never FR-07 alerts: a PO awaiting
 * approval and a variance-flagged GRN are FR-04 documents with their own
 * screens, so those routes redirect there rather than showing an empty
 * alert table that would read as a bug.
 */
const ALERT_TYPES_FOR_ROUTE: Record<string, AlertType[] | undefined> = {
  'low-stock': ['LOW_STOCK', 'OUT_OF_STOCK'],
  expiry: ['EXPIRY_WARNING'],
  unacknowledged: undefined, // every type — filtered by status instead
};

const REDIRECTS: Record<string, string> = {
  'po-approvals': '/purchase-orders',
  'grn-variance': '/grn',
};

const TYPE_VARIANT: Record<AlertType, 'warning' | 'danger'> = {
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
  EXPIRY_WARNING: 'warning',
};

export function AlertList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { type } = useParams<{ type: string }>();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const redirect = type ? REDIRECTS[type] : undefined;

  const load = useCallback(async () => {
    if (redirect) return;
    setLoading(true);
    setError(null);
    try {
      const types = type ? ALERT_TYPES_FOR_ROUTE[type] : undefined;
      const rows = await alertsApi.list({
        outletId,
        // "Unacknowledged" is a status filter; every other route is a type
        // filter. The bar's badges genuinely mean different things.
        status: type === 'unacknowledged' ? 'OPEN' : undefined,
        type: types?.length === 1 ? types[0] : undefined,
      });
      // LOW_STOCK and OUT_OF_STOCK share one badge but the API filters on a
      // single type, so that pair is narrowed here.
      setAlerts(types && types.length > 1 ? rows.filter((row) => types.includes(row.type)) : rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('alerts.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, redirect, type, t]);

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: 'acknowledge' | 'resolve' | 'po') {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'po') {
        const po = await alertsApi.createPoDraft(id);
        navigate(`/purchase-orders/${po.id}`);
        return;
      }
      if (action === 'acknowledge') await alertsApi.acknowledge(id);
      else await alertsApi.resolve(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('alerts.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  if (redirect) return null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">
          {type ? t(`alerts.${type}`) : t('alerts.title')}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">{t('alerts.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-7 w-7" />}
          title={t('alerts.empty.title')}
          description={t('alerts.empty.description')}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">{t('alerts.columns.alert')}</th>
                <th className="px-4 py-3">{t('alerts.columns.raised')}</th>
                <th className="px-4 py-3">{t('alerts.columns.status')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge variant={TYPE_VARIANT[alert.type]} className="w-fit">
                        {t(`alerts.type.${alert.type}`)}
                      </Badge>
                      <span>{alert.message}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(alert.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={alert.status === 'OPEN' ? 'warning' : 'neutral'}>
                      {t(`alerts.status.${alert.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {alert.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === alert.id}
                          onClick={() => act(alert.id, 'acknowledge')}
                        >
                          {t('alerts.acknowledge')}
                        </Button>
                      )}
                      {alert.status !== 'RESOLVED' && (
                        <>
                          {/* Reordering answers a stock shortage; it does
                              nothing about stock that is about to spoil. */}
                          {alert.itemId && alert.type !== 'EXPIRY_WARNING' && (
                            <Button
                              size="sm"
                              disabled={busyId === alert.id}
                              onClick={() => act(alert.id, 'po')}
                            >
                              {t('alerts.createPoDraft')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === alert.id}
                            onClick={() => act(alert.id, 'resolve')}
                          >
                            {t('alerts.resolve')}
                          </Button>
                        </>
                      )}
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
