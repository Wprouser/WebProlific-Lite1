import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { purchaseOrdersApi, type ApiPurchaseOrder, type POStatus } from '@/lib/purchase-orders-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

const PO_STATUSES: POStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT_TO_SUPPLIER',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CLOSED',
  'REJECTED',
  'CANCELLED',
];

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success-solid' | 'danger-solid' | 'warning'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SENT_TO_SUPPLIER: 'info',
  PARTIALLY_RECEIVED: 'warning',
  FULLY_RECEIVED: 'success-solid',
  CLOSED: 'success-solid',
  REJECTED: 'danger-solid',
  CANCELLED: 'danger-solid',
};

export function PurchaseOrders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<ApiPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);

  const [statusFilter, setStatusFilter] = useState<POStatus | ''>('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await purchaseOrdersApi.list({
        outletId,
        status: statusFilter || undefined,
        supplierId: supplierFilter || undefined,
      });
      setOrders(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('purchaseOrders.list.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, statusFilter, supplierFilter, t]);

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
          <h1 className="font-display text-xl font-semibold text-foreground">{t('purchaseOrders.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('purchaseOrders.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/purchase-orders/new')}>
          <Plus className="h-4 w-4" />
          {t('purchaseOrders.addNew')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-auto min-w-48"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as POStatus | '')}
        >
          <option value="">{t('purchaseOrders.list.allStatuses')}</option>
          {PO_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`purchaseOrders.status.${status}`)}
            </option>
          ))}
        </Select>
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
          icon={<FileText className="h-7 w-7" />}
          title={t('purchaseOrders.list.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title={t('purchaseOrders.list.empty.title')}
          description={t('purchaseOrders.list.empty.description')}
          action={<Button onClick={() => navigate('/purchase-orders/new')}>{t('purchaseOrders.list.empty.action')}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">{t('purchaseOrders.list.supplier')}</th>
                <th className="px-4 py-3">{t('purchaseOrders.list.status')}</th>
                <th className="px-4 py-3">{t('purchaseOrders.list.total')}</th>
                <th className="px-4 py-3">{t('purchaseOrders.list.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((po) => (
                <tr
                  key={po.id}
                  className="cursor-pointer hover:bg-surface-secondary/40"
                  onClick={() => navigate(`/purchase-orders/${po.id}`)}
                >
                  <td className="px-4 py-3">{supplierName(po.supplierId)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[po.status] ?? 'neutral'}>{t(`purchaseOrders.status.${po.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {po.currencyCode} {po.totalValue}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(po.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
