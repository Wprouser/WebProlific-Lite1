import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { SupplierFormModal } from '@/components/suppliers/SupplierFormModal';
import {
  suppliersApi,
  type ApiSupplier,
  type ApiSupplierPriceHistory,
  type ApiSupplierPerformance,
} from '@/lib/suppliers-api';
import { currenciesApi, type ApiCurrency } from '@/lib/currencies-api';
import { outletsApi } from '@/lib/outlets-api';
import { ApiError } from '@/lib/api-client';
import { getSession } from '@/lib/auth-store';

const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'];

/** FR-03's Supplier Detail screen — spec AC: "displays stateOrProvince
 * clearly, since it's the key piece of context a user needs to manually
 * pick the correct GST tax rate variant on a PO/GRN for that supplier." */
export function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canMutate = MUTATE_ROLES.includes(getSession()?.user.effectiveRole ?? '');

  const [supplier, setSupplier] = useState<ApiSupplier | null>(null);
  const [currencies, setCurrencies] = useState<ApiCurrency[]>([]);
  const [priceHistory, setPriceHistory] = useState<ApiSupplierPriceHistory[]>([]);
  const [performance, setPerformance] = useState<ApiSupplierPerformance | null>(null);
  const [outletBaseCurrency, setOutletBaseCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [supplierResult, historyResult, performanceResult] = await Promise.all([
        suppliersApi.get(id),
        suppliersApi.priceHistory(id),
        suppliersApi.performance(id),
      ]);
      setSupplier(supplierResult);
      setPriceHistory(historyResult);
      setPerformance(performanceResult);
      const settings = await outletsApi.getCurrencySettings(supplierResult.outletId);
      setOutletBaseCurrency(settings.baseCurrency);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('suppliers.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    currenciesApi.list().then(setCurrencies).catch(() => setCurrencies([]));
  }, []);

  function currencyLabel(code: string | null): string {
    if (!code) return '—';
    const currency = currencies.find((c) => c.code === code);
    return currency ? `${currency.code} — ${currency.name}` : code;
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !supplier) {
    return (
      <EmptyState
        icon={<Truck className="h-7 w-7" />}
        title={t('suppliers.detail.loadError')}
        description={error ?? undefined}
        action={<Button onClick={load}>{t('common.refresh')}</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/suppliers')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('suppliers.detail.back')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl font-semibold text-foreground">{supplier.name}</h1>
          <Badge variant={supplier.isActive ? 'success-solid' : 'neutral'}>
            {supplier.isActive ? t('suppliers.status.active') : t('suppliers.status.inactive')}
          </Badge>
        </div>
        {canMutate && (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('suppliers.edit')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
          <DetailField label={t('suppliers.table.supplierCode')} value={supplier.supplierCode} />
          <DetailField label={t('suppliers.form.contactPerson')} value={supplier.contactPerson} />
          <DetailField label={t('suppliers.form.phone')} value={supplier.phone} />
          <DetailField label={t('suppliers.form.email')} value={supplier.email} />
          <DetailField
            label={t('suppliers.form.addressLine')}
            value={[supplier.addressLine, supplier.city, supplier.postalCode].filter(Boolean).join(', ') || null}
          />
          {/* Spec AC: shown clearly/prominently — the key context for manually
           * picking the correct GST Intra/Inter-state tax rate on a PO/GRN. */}
          <div className="rounded-md border border-border-strong bg-surface-secondary/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('suppliers.form.stateOrProvince')}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">
              {supplier.stateOrProvince ?? t('suppliers.detail.notSet')}
              {supplier.countryCode ? ` (${supplier.countryCode})` : ''}
            </p>
          </div>
          <DetailField label={t('suppliers.form.preferredCurrency')} value={currencyLabel(supplier.preferredCurrency)} />
          <DetailField
            label={t('suppliers.form.taxRegistrationType')}
            value={
              supplier.taxRegistrationType
                ? `${supplier.taxRegistrationType}${
                    supplier.taxRegistrationNumber ? `: ${supplier.taxRegistrationNumber}` : ''
                  }`
                : null
            }
          />
          <DetailField label={t('suppliers.form.paymentTerms')} value={supplier.paymentTerms} />
          <DetailField
            label={t('suppliers.form.leadTimeDays')}
            value={supplier.leadTimeDays !== null ? String(supplier.leadTimeDays) : null}
          />
          <DetailField label={t('suppliers.form.bankAccountName')} value={supplier.bankAccountName} />
          <DetailField label={t('suppliers.form.bankAccountNumber')} value={supplier.bankAccountNumber} />
          <DetailField label={t('suppliers.form.bankIfscOrSwift')} value={supplier.bankIfscOrSwift} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-foreground">{t('suppliers.detail.performance')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('suppliers.detail.totalGrns')} value={String(performance?.totalGrns ?? 0)} />
          <StatCard
            label={t('suppliers.detail.onTimeRate')}
            value={performance?.onTimeRate !== null && performance?.onTimeRate !== undefined ? `${performance.onTimeRate}%` : t('suppliers.detail.notYetAvailable')}
          />
          <StatCard
            label={t('suppliers.detail.priceConsistency')}
            value={
              performance?.priceConsistencyScore !== null && performance?.priceConsistencyScore !== undefined
                ? String(performance.priceConsistencyScore)
                : t('suppliers.detail.notYetAvailable')
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-foreground">{t('suppliers.detail.priceHistory')}</h2>
        {priceHistory.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-7 w-7" />}
            title={t('suppliers.detail.priceHistoryEmpty.title')}
            description={t('suppliers.detail.priceHistoryEmpty.description')}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {priceHistory.map((entry) => {
              const showBaseCurrencyEquivalent =
                entry.priceInBaseCurrency !== null && outletBaseCurrency && entry.currencyCode !== outletBaseCurrency;
              return (
                <li key={entry.id} className="rounded-md border border-border p-3 text-sm">
                  {entry.currencyCode} {entry.price}
                  {showBaseCurrencyEquivalent && (
                    <span className="text-foreground-muted"> (≈ {outletBaseCurrency} {entry.priceInBaseCurrency})</span>
                  )}
                  {' — '}
                  {new Date(entry.recordedAt).toLocaleDateString()} ({entry.source})
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canMutate && (
        <SupplierFormModal
          open={editOpen}
          onOpenChange={setEditOpen}
          supplier={supplier}
          currencies={currencies}
          outletId={supplier.outletId}
          onSaved={() => {
            setEditOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value || '—'}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
