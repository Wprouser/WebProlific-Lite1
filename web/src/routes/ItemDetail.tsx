import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Copy, MoreVertical, Package, Pencil, PlusCircle, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ItemFormModal } from '@/components/items/ItemFormModal';
import { CategoryManagerModal } from '@/components/items/CategoryManagerModal';
import { CloneItemDialog } from '@/components/items/CloneItemDialog';
import { ItemImageGallery } from '@/components/items/ItemImageGallery';
import { StockTransactionFormModal } from '@/components/stock/StockTransactionFormModal';
import { StockTransactionsTable } from '@/components/stock/StockTransactionsTable';
import {
  categoriesApi,
  itemImagesApi,
  itemsApi,
  type ApiCategory,
  type ApiItem,
  type ApiItemImage,
} from '@/lib/items-api';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { stockTransactionsApi, type ApiStockTransaction } from '@/lib/stock-transactions-api';
import { transactionLogApi, type ApiTransactionLogEntry } from '@/lib/transaction-log-api';
import { ApiError } from '@/lib/api-client';
import { getSession } from '@/lib/auth-store';

type Tab = 'overview' | 'transactions' | 'history';
const TABS: Tab[] = ['overview', 'transactions', 'history'];

/**
 * FR-01's Item Detail Screen: tabbed master-data/transactions/history view
 * with a right-hand stock summary panel, replacing the old
 * click-row-to-open-edit-modal behavior on the Items list — ItemFormModal
 * is now only opened from here (Edit) or for creating a new item.
 */
export function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [item, setItem] = useState<ApiItem | null>(null);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);
  const [images, setImages] = useState<ApiItemImage[]>([]);
  const [transactions, setTransactions] = useState<ApiStockTransaction[]>([]);
  const [historyEntries, setHistoryEntries] = useState<ApiTransactionLogEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRestricted, setHistoryRestricted] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [editOpen, setEditOpen] = useState(false);
  const [adjustStockOpen, setAdjustStockOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [confirmingToggleActive, setConfirmingToggleActive] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [itemResult, imagesResult, transactionsResult] = await Promise.all([
        itemsApi.get(id),
        itemImagesApi.list(id),
        stockTransactionsApi.list({ itemId: id }),
      ]);
      setItem(itemResult);
      setImages(imagesResult);
      setTransactions(transactionsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    categoriesApi.list().then(setCategories).catch(() => setCategories([]));
    taxRatesApi.list().then(setTaxRates).catch(() => setTaxRates([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    setHistoryError(null);
    setHistoryRestricted(false);
    transactionLogApi
      .listForEntity('Item', id)
      .then(setHistoryEntries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setHistoryRestricted(true);
        } else {
          setHistoryError(err instanceof ApiError ? err.message : t('items.detail.history.loadError'));
        }
      });
  }, [id, t]);

  function refreshImages() {
    if (!id) return;
    itemImagesApi.list(id).then(setImages).catch(() => {});
  }

  function handleSaved() {
    setEditOpen(false);
    load();
  }

  function handleCloned(clone: ApiItem) {
    setCloneOpen(false);
    navigate(`/items/${clone.id}`);
  }

  async function handleToggleActive() {
    if (!item) return;
    setTogglingActive(true);
    try {
      const updated = item.isActive ? await itemsApi.deactivate(item.id) : await itemsApi.reactivate(item.id);
      setItem(updated);
      setConfirmingToggleActive(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.loadError'));
    } finally {
      setTogglingActive(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <EmptyState
        icon={<Package className="h-7 w-7" />}
        title={error ? t('items.detail.loadError') : t('items.detail.notFound')}
        description={error ?? undefined}
        action={
          <Button variant="outline" onClick={() => navigate('/items')}>
            {t('items.detail.back')}
          </Button>
        }
      />
    );
  }

  const categoryName = categories.find((c) => c.id === item.categoryId)?.name ?? '—';
  const taxRateName = taxRates.find((r) => r.id === item.defaultTaxRateId)?.name ?? item.defaultTaxRateId;
  const primaryImage = images.find((img) => img.isPrimary) ?? images[0];
  const openingBalanceTxn = transactions.find((txn) => txn.type === 'OPENING_BALANCE');
  const stockValue =
    item.costPrice !== undefined ? (Number(item.currentStock) * Number(item.costPrice)).toFixed(2) : null;

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/items"
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('items.detail.back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-secondary">
            {primaryImage ? (
              <img src={primaryImage.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-6 w-6 text-foreground-muted" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-foreground">{item.name}</h1>
              <Badge variant={item.isActive ? 'success-solid' : 'neutral'}>
                {item.isActive ? t('items.status.active') : t('items.status.inactive')}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-foreground-muted">{item.sku}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('items.detail.edit')}
          </Button>
          <Button onClick={() => setAdjustStockOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            {t('items.detail.adjustStock')}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline" size="icon" aria-label={t('items.detail.more')}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 min-w-48 rounded-md border border-border bg-surface p-1.5 shadow-lg"
              >
                <DropdownMenu.Item
                  onSelect={() => setCloneOpen(true)}
                  className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none hover:bg-surface-secondary"
                >
                  <Copy className="h-4 w-4" />
                  {t('items.detail.clone')}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setConfirmingToggleActive(true)}
                  className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none hover:bg-surface-secondary"
                >
                  {item.isActive ? t('items.detail.markInactive') : t('items.detail.reactivate')}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setCategoryManagerOpen(true)}
                  className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none hover:bg-surface-secondary"
                >
                  <Settings2 className="h-4 w-4" />
                  {t('items.detail.manageCategories')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {confirmingToggleActive && (
        <div className="flex items-center gap-3 rounded-md border border-border-strong p-3.5">
          <span className="text-sm text-foreground-muted">
            {item.isActive ? t('items.detail.confirmDeactivate') : t('items.detail.confirmReactivate')}
          </span>
          <Button
            variant={item.isActive ? 'danger' : 'primary'}
            size="sm"
            disabled={togglingActive}
            onClick={handleToggleActive}
          >
            {togglingActive
              ? item.isActive
                ? t('items.detail.deactivating')
                : t('items.detail.reactivating')
              : t('items.detail.confirmYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingToggleActive(false)}>
            {t('items.detail.cancel')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 border-b border-border">
            {TABS.map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={
                  'px-4 py-2.5 text-sm font-medium transition-colors ' +
                  (tab === tabKey
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-foreground-muted hover:text-foreground')
                }
              >
                {t(`items.detail.tabs.${tabKey}`)}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="flex flex-col gap-5">
              <Card>
                <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
                  <OverviewField label={t('items.detail.overview.category')} value={categoryName} />
                  <OverviewField label={t('items.detail.overview.unit')} value={t(`items.units.${item.unit}`)} />
                  <OverviewField
                    label={t('items.detail.overview.reorderPoint')}
                    value={`${item.minStock} / ${item.maxStock}`}
                  />
                  {item.shelfLifeDays != null && (
                    <OverviewField
                      label={t('items.detail.overview.shelfLifeDays')}
                      value={t('items.detail.overview.shelfLifeDaysValue', { count: item.shelfLifeDays })}
                    />
                  )}
                  <OverviewField
                    label={t('items.detail.overview.storageLocation')}
                    value={item.storageLocation ?? '—'}
                  />
                  {item.costPrice !== undefined && (
                    <OverviewField label={t('items.detail.overview.costPrice')} value={item.costPrice} />
                  )}
                  {item.defaultSupplierId && (
                    <OverviewField
                      label={t('items.detail.overview.defaultSupplier')}
                      value={item.defaultSupplierId}
                    />
                  )}
                  {item.defaultTaxRateId && (
                    <OverviewField label={t('items.detail.overview.defaultTaxRate')} value={taxRateName!} />
                  )}
                  {item.purchaseGLAccount && (
                    <OverviewField
                      label={t('items.detail.overview.purchaseGLAccount')}
                      value={item.purchaseGLAccount}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <ItemImageGallery itemId={item.id} images={images} onChanged={refreshImages} />
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'transactions' && <StockTransactionsTable transactions={transactions} hideItemColumn />}

          {tab === 'history' && (
            <div className="flex flex-col gap-2">
              {historyRestricted ? (
                <p className="text-sm text-foreground-muted">{t('items.detail.history.restricted')}</p>
              ) : historyError ? (
                <p className="text-sm text-danger">{historyError}</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('items.detail.history.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {historyEntries.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-border bg-surface p-3 text-sm">
                      <p className="text-foreground">{entry.summary}</p>
                      <p className="mt-0.5 text-xs text-foreground-muted">
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardContent className="flex flex-col gap-4 pt-4">
            <SummaryRow
              label={t('items.detail.currentStock')}
              value={`${item.currentStock} ${t(`items.units.${item.unit}`)}`}
            />
            {stockValue !== null && <SummaryRow label={t('items.detail.stockValue')} value={stockValue} />}
            {openingBalanceTxn && (
              <SummaryRow
                label={t('items.detail.openingStock')}
                value={`${openingBalanceTxn.quantity} ${t(`items.units.${item.unit}`)}${
                  item.costPrice ? ` @ ${item.costPrice}` : ''
                }`}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <ItemFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        item={item}
        categories={categories}
        taxRates={taxRates}
        outletId={outletId}
        onSaved={handleSaved}
      />
      <StockTransactionFormModal
        open={adjustStockOpen}
        onOpenChange={setAdjustStockOpen}
        items={[item]}
        defaultItemId={item.id}
        onSaved={() => {
          setAdjustStockOpen(false);
          load();
        }}
      />
      <CloneItemDialog open={cloneOpen} onOpenChange={setCloneOpen} item={item} onCloned={handleCloned} />
      <CategoryManagerModal
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        outletId={outletId}
        onCreate={(category) => setCategories((prev) => [...prev, category])}
      />
    </div>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
