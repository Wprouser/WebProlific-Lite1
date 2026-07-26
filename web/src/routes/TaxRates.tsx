import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Percent, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/ResponsiveTable';
import { TaxRateFormModal } from '@/components/tax-rates/TaxRateFormModal';
import { TaxRatePreviewModal } from '@/components/tax-rates/TaxRatePreviewModal';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * FR-04's Tax Configuration Screen — standalone management of outlet-level
 * shared reference data, the same relationship Category management already
 * has to the Item screen. Consumed identically by the Item Master's
 * default-tax dropdown (and, once built, PO/GRN line selectors) via the
 * same GET /tax-rates list — no per-screen duplication.
 */
// Mirrors TaxRatesService's own MUTATE_ROLES on the backend — kept in sync
// manually since the two run in separate deployables. This is a UX
// convenience only (hiding actions a user can't perform); the RBAC guard
// server-side remains the actual enforcement boundary.
const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER'];

export function TaxRates() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];
  const canMutate = MUTATE_ROLES.includes(getSession()?.user.effectiveRole ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ApiTaxRate | null>(null);
  const [confirmingRate, setConfirmingRate] = useState<ApiTaxRate | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [previewingRate, setPreviewingRate] = useState<ApiTaxRate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // No isActive filter — this screen shows both, unlike the Item form's
      // dropdown which only offers active rates for new selections.
      const result = await taxRatesApi.list();
      setTaxRates(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('taxRates.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingRate(null);
    setFormOpen(true);
  }

  function openEdit(rate: ApiTaxRate) {
    setEditingRate(rate);
    setFormOpen(true);
  }

  function handleSaved() {
    setFormOpen(false);
    load();
  }

  const activeCount = taxRates.filter((r) => r.isActive).length;

  async function handleDeactivate() {
    if (!confirmingRate) return;
    setDeactivating(true);
    try {
      await taxRatesApi.deactivate(confirmingRate.id);
      setConfirmingRate(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('taxRates.loadError'));
    } finally {
      setDeactivating(false);
    }
  }

  const columns: ResponsiveTableColumn<ApiTaxRate>[] = [
    {
      key: 'name',
      header: t('taxRates.table.name'),
      render: (rate) => <span className="font-medium text-foreground">{rate.name}</span>,
    },
    {
      key: 'ratePercent',
      header: t('taxRates.table.rate'),
      render: (rate) => `${rate.ratePercent}%`,
    },
    {
      key: 'type',
      header: t('taxRates.table.type'),
      render: (rate) => (
        <Badge variant={rate.isCompound ? 'info' : 'neutral'}>
          {rate.isCompound ? t('taxRates.type.split') : t('taxRates.type.simple')}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('taxRates.table.status'),
      render: (rate) => (
        <Badge variant={rate.isActive ? 'success-solid' : 'neutral'}>
          {rate.isActive ? t('taxRates.status.active') : t('taxRates.status.inactive')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (rate) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPreviewingRate(rate)}>
            {t('taxRates.preview.action')}
          </Button>
          {canMutate && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(rate)}>
              {t('taxRates.edit')}
            </Button>
          )}
          {canMutate && rate.isActive && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingRate(rate)}>
              {t('taxRates.deactivate')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/items')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('taxRates.back')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('taxRates.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('taxRates.subtitle')}</p>
        </div>
        {canMutate && (
          <Button onClick={openCreate} disabled={!outletId}>
            <Plus className="h-4 w-4" />
            {t('taxRates.addTaxRate')}
          </Button>
        )}
      </div>

      {confirmingRate && (
        <div className="flex items-center gap-3 rounded-md border border-border-strong p-3.5">
          <span className="text-sm text-foreground-muted">
            {activeCount <= 1
              ? t('taxRates.confirmLastActive', { name: confirmingRate.name })
              : t('taxRates.confirmDeactivate', { name: confirmingRate.name })}
          </span>
          <Button variant="danger" size="sm" disabled={deactivating} onClick={handleDeactivate}>
            {deactivating ? t('taxRates.deactivating') : t('taxRates.confirmYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingRate(null)}>
            {t('taxRates.cancel')}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<Percent className="h-7 w-7" />}
          title={t('taxRates.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : taxRates.length === 0 ? (
        <EmptyState
          icon={<Percent className="h-7 w-7" />}
          title={t('taxRates.empty.title')}
          description={t('taxRates.empty.description')}
          action={canMutate ? <Button onClick={openCreate}>{t('taxRates.addTaxRate')}</Button> : undefined}
        />
      ) : (
        <ResponsiveTable columns={columns} data={taxRates} getRowKey={(rate) => rate.id} />
      )}

      <TaxRateFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        taxRate={editingRate}
        outletId={outletId}
        onSaved={handleSaved}
      />

      <TaxRatePreviewModal
        open={previewingRate !== null}
        onOpenChange={(open) => !open && setPreviewingRate(null)}
        taxRate={previewingRate}
      />
    </div>
  );
}
