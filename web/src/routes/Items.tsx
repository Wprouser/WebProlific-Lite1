import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, Percent, Plus, Search, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/ResponsiveTable';
import { ItemFormModal } from '@/components/items/ItemFormModal';
import { CategoryManagerModal } from '@/components/items/CategoryManagerModal';
import { UnitManagerModal } from '@/components/items/UnitManagerModal';
import { categoriesApi, itemsApi, unitsApi, type ApiCategory, type ApiItem, type ApiUnitOfMeasure } from '@/lib/items-api';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

type StatusFilter = 'active' | 'inactive' | 'all';

/**
 * FR-01: Item Master list, plus create/edit/deactivate and category
 * management as Modals off this screen. Wired to the real backend
 * (GET/POST/PATCH/DELETE /items, GET/POST /items/categories) — mock UI
 * phase is over for this screen.
 */
export function Items() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [units, setUnits] = useState<ApiUnitOfMeasure[]>([]);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [belowMinOnly, setBelowMinOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [unitManagerOpen, setUnitManagerOpen] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await itemsApi.list({
        categoryId: categoryFilter || undefined,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        search: search.trim() || undefined,
        belowMinStock: belowMinOnly,
      });
      setItems(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.loadError'));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, statusFilter, search, belowMinOnly, t]);

  // Debounced so free-text search doesn't fire a request per keystroke.
  useEffect(() => {
    const id = window.setTimeout(loadItems, 300);
    return () => window.clearTimeout(id);
  }, [loadItems]);

  useEffect(() => {
    categoriesApi.list().then(setCategories).catch(() => setCategories([]));
    unitsApi.list().then(setUnits).catch(() => setUnits([]));
    taxRatesApi.list().then(setTaxRates).catch(() => setTaxRates([]));
  }, []);

  const categoryName = (categoryId: string) => categories.find((c) => c.id === categoryId)?.name ?? '—';
  const unitAbbreviation = (unitId: string) => units.find((u) => u.id === unitId)?.abbreviation ?? '—';

  function openCreate() {
    setFormOpen(true);
  }

  function handleSaved() {
    setFormOpen(false);
    loadItems();
  }

  function handleCreateCategory(category: ApiCategory) {
    setCategories((prev) => [...prev, category]);
  }

  function handleCreateUnit(unit: ApiUnitOfMeasure) {
    setUnits((prev) => [...prev, unit]);
  }

  function handleUpdateUnit(unit: ApiUnitOfMeasure) {
    setUnits((prev) => prev.map((u) => (u.id === unit.id ? unit : u)));
  }

  const columns: ResponsiveTableColumn<ApiItem>[] = [
    {
      key: 'name',
      header: t('items.table.name'),
      render: (item) => (
        <button
          onClick={() => navigate(`/items/${item.id}`)}
          className="text-left font-medium text-foreground hover:text-primary hover:underline"
        >
          {item.name}
        </button>
      ),
    },
    {
      key: 'sku',
      header: t('items.table.sku'),
      render: (item) => <span className="text-foreground-muted">{item.sku}</span>,
    },
    {
      key: 'category',
      header: t('items.table.category'),
      render: (item) => categoryName(item.categoryId),
    },
    {
      key: 'stock',
      header: t('items.table.stock'),
      render: (item) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {item.currentStock} {unitAbbreviation(item.unitId)}
          </span>
          {Number(item.currentStock) < Number(item.minStock) && (
            <Badge variant="danger-solid">{t('items.status.lowStock')}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'costPrice',
      header: t('items.table.costPrice'),
      render: (item) => item.costPrice ?? '—',
    },
    {
      key: 'status',
      header: t('items.table.status'),
      render: (item) => (
        <Badge variant={item.isActive ? 'success-solid' : 'neutral'}>
          {item.isActive ? t('items.status.active') : t('items.status.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('items.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('items.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCategoryManagerOpen(true)}>
            <Settings2 className="h-4 w-4" />
            {t('items.manageCategories')}
          </Button>
          <Button variant="outline" onClick={() => setUnitManagerOpen(true)}>
            <Settings2 className="h-4 w-4" />
            {t('items.manageUnits')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/tax-rates')}>
            <Percent className="h-4 w-4" />
            {t('items.manageTaxRates')}
          </Button>
          <Button onClick={openCreate} disabled={!outletId}>
            <Plus className="h-4 w-4" />
            {t('items.addItem')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            className="pl-11"
            placeholder={t('items.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-auto min-w-40"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">{t('items.filters.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">{t('items.filters.allStatus')}</option>
          <option value="active">{t('items.filters.active')}</option>
          <option value="inactive">{t('items.filters.inactive')}</option>
        </Select>
        <label className="flex h-12 items-center gap-2 rounded-md border border-border-strong px-4 text-sm text-foreground-muted">
          <input
            type="checkbox"
            checked={belowMinOnly}
            onChange={(e) => setBelowMinOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('items.filters.belowMinStock')}
        </label>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<Package className="h-7 w-7" />}
          title={t('items.loadError')}
          description={error}
          action={<Button onClick={loadItems}>{t('common.refresh')}</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7" />}
          title={t('items.empty.title')}
          description={t('items.empty.description')}
          action={<Button onClick={openCreate}>{t('items.empty.action')}</Button>}
        />
      ) : (
        <ResponsiveTable columns={columns} data={items} getRowKey={(item) => item.id} />
      )}

      <ItemFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        item={null}
        categories={categories}
        units={units}
        taxRates={taxRates}
        outletId={outletId}
        onSaved={handleSaved}
      />
      <CategoryManagerModal
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        outletId={outletId}
        onCreate={handleCreateCategory}
      />
      <UnitManagerModal
        open={unitManagerOpen}
        onOpenChange={setUnitManagerOpen}
        units={units}
        outletId={outletId}
        onCreate={handleCreateUnit}
        onUpdate={handleUpdateUnit}
      />
    </div>
  );
}
