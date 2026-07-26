import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { grnApi, type ApiGrn } from '@/lib/grn-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

export function GrnList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grns, setGrns] = useState<ApiGrn[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [supplierFilter, setSupplierFilter] = useState('');

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await grnApi.list({ outletId, supplierId: supplierFilter || undefined });
      setGrns(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grn.list.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, supplierFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!outletId) return;
    suppliersApi.list({ outletId, isActive: true }).then(setSuppliers).catch(() => setSuppliers([]));
  }, [outletId]);

  function supplierName(supplierId: string): string {
    return suppliers.find((s) => s.id === supplierId)?.name ?? supplierId;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('grn.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('grn.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/grn/new')}>
          <Plus className="h-4 w-4" />
          {t('grn.addNew')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-auto min-w-48" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">{t('purchaseOrders.list.allSuppliers')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<ClipboardCheck className="h-7 w-7" />}
          title={t('grn.list.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : grns.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-7 w-7" />}
          title={t('grn.list.empty.title')}
          description={t('grn.list.empty.description')}
          action={<Button onClick={() => navigate('/grn/new')}>{t('grn.list.empty.action')}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">{t('purchaseOrders.list.supplier')}</th>
                <th className="px-4 py-3">{t('grn.list.source')}</th>
                <th className="px-4 py-3">{t('purchaseOrders.list.total')}</th>
                <th className="px-4 py-3">{t('grn.list.receivedAt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grns.map((grn) => (
                <tr
                  key={grn.id}
                  className="cursor-pointer hover:bg-surface-secondary/40"
                  onClick={() => navigate(`/grn/${grn.id}`)}
                >
                  <td className="px-4 py-3">{supplierName(grn.supplierId)}</td>
                  <td className="px-4 py-3">
                    {grn.purchaseOrderId ? (
                      <Badge variant="info">{t('grn.detail.againstPo')}</Badge>
                    ) : (
                      <Badge variant="neutral">{t('grn.detail.direct')}</Badge>
                    )}
                    {grn.varianceFlagged && (
                      <Badge variant="warning" className="ms-1.5">
                        {t('grn.detail.varianceFlagged')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {grn.currencyCode} {grn.totalValue}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(grn.receivedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
