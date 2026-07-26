import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, ShoppingCart, Truck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/ResponsiveTable';
import { SupplierFormModal } from '@/components/suppliers/SupplierFormModal';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { currenciesApi, type ApiCurrency } from '@/lib/currencies-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

type StatusFilter = 'active' | 'inactive' | 'all';

// Matches Items/Categories' own role set — Suppliers is operational
// procurement master data, not finance-config like Tax Rate/Currency, so
// OUTLET_MANAGER-tier staff can maintain it directly, not just CHAIN_OWNER/
// PROPERTY_MANAGER.
const MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'];

/** FR-03's Supplier Management list screen. */
export function Suppliers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];
  const canMutate = MUTATE_ROLES.includes(getSession()?.user.effectiveRole ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [currencies, setCurrencies] = useState<ApiCurrency[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<ApiSupplier | null>(null);
  const [confirmingSupplier, setConfirmingSupplier] = useState<ApiSupplier | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await suppliersApi.list({
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        search: search.trim() || undefined,
      });
      setSuppliers(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('suppliers.loadError'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, t]);

  // Debounced so free-text search doesn't fire a request per keystroke.
  useEffect(() => {
    const id = window.setTimeout(load, 300);
    return () => window.clearTimeout(id);
  }, [load]);

  useEffect(() => {
    currenciesApi.list().then(setCurrencies).catch(() => setCurrencies([]));
  }, []);

  function openCreate() {
    setEditingSupplier(null);
    setFormOpen(true);
  }

  function openEdit(supplier: ApiSupplier) {
    setEditingSupplier(supplier);
    setFormOpen(true);
  }

  function handleSaved() {
    setFormOpen(false);
    load();
  }

  async function handleDeactivate() {
    if (!confirmingSupplier) return;
    setDeactivating(true);
    try {
      await suppliersApi.deactivate(confirmingSupplier.id);
      setConfirmingSupplier(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('suppliers.loadError'));
    } finally {
      setDeactivating(false);
    }
  }

  const columns: ResponsiveTableColumn<ApiSupplier>[] = [
    {
      key: 'name',
      header: t('suppliers.table.name'),
      render: (supplier) => (
        <button
          onClick={() => navigate(`/suppliers/${supplier.id}`)}
          className="text-left font-medium text-foreground hover:text-primary hover:underline"
        >
          {supplier.name}
        </button>
      ),
    },
    {
      key: 'supplierCode',
      header: t('suppliers.table.supplierCode'),
      render: (supplier) => supplier.supplierCode ?? '—',
    },
    {
      key: 'contact',
      header: t('suppliers.table.contact'),
      render: (supplier) => (
        <div className="flex flex-col text-sm">
          <span>{supplier.phone ?? '—'}</span>
          <span className="text-foreground-muted">{supplier.email ?? ''}</span>
        </div>
      ),
    },
    {
      key: 'preferredCurrency',
      header: t('suppliers.table.preferredCurrency'),
      render: (supplier) => supplier.preferredCurrency ?? '—',
    },
    {
      key: 'taxRegistration',
      header: t('suppliers.table.taxRegistration'),
      render: (supplier) =>
        supplier.taxRegistrationType ? (
          <span>
            {supplier.taxRegistrationType}
            {supplier.taxRegistrationNumber ? `: ${supplier.taxRegistrationNumber}` : ''}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: t('suppliers.table.status'),
      render: (supplier) => (
        <Badge variant={supplier.isActive ? 'success-solid' : 'neutral'}>
          {supplier.isActive ? t('suppliers.status.active') : t('suppliers.status.inactive')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (supplier) =>
        canMutate ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => openEdit(supplier)}>
              {t('suppliers.edit')}
            </Button>
            {supplier.isActive && (
              <Button variant="outline" size="sm" onClick={() => setConfirmingSupplier(supplier)}>
                {t('suppliers.deactivate')}
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('suppliers.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('suppliers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/purchase-orders/new')}>
            <ShoppingCart className="h-4 w-4" />
            {t('suppliers.newPo')}
          </Button>
          {canMutate && (
            <Button onClick={openCreate} disabled={!outletId}>
              <Plus className="h-4 w-4" />
              {t('suppliers.addSupplier')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            className="pl-11"
            placeholder={t('suppliers.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-auto min-w-36"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">{t('suppliers.filters.allStatus')}</option>
          <option value="active">{t('suppliers.filters.active')}</option>
          <option value="inactive">{t('suppliers.filters.inactive')}</option>
        </Select>
      </div>

      {confirmingSupplier && (
        <div className="flex items-center gap-3 rounded-md border border-border-strong p-3.5">
          <span className="text-sm text-foreground-muted">
            {t('suppliers.confirmDeactivate', { name: confirmingSupplier.name })}
          </span>
          <Button variant="danger" size="sm" disabled={deactivating} onClick={handleDeactivate}>
            {deactivating ? t('suppliers.deactivating') : t('suppliers.confirmYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingSupplier(null)}>
            {t('suppliers.cancel')}
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
          icon={<Truck className="h-7 w-7" />}
          title={t('suppliers.loadError')}
          description={error}
          action={<Button onClick={load}>{t('common.refresh')}</Button>}
        />
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-7 w-7" />}
          title={t('suppliers.empty.title')}
          description={t('suppliers.empty.description')}
          action={canMutate ? <Button onClick={openCreate}>{t('suppliers.addSupplier')}</Button> : undefined}
        />
      ) : (
        <ResponsiveTable columns={columns} data={suppliers} getRowKey={(supplier) => supplier.id} />
      )}

      {canMutate && (
        <SupplierFormModal
          open={formOpen}
          onOpenChange={setFormOpen}
          supplier={editingSupplier}
          currencies={currencies}
          outletId={outletId}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
