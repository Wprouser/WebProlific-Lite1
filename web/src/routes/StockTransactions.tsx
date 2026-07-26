import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StockTransactionFormModal } from '@/components/stock/StockTransactionFormModal';
import { StockTransactionsTable } from '@/components/stock/StockTransactionsTable';
import { itemsApi, type ApiItem } from '@/lib/items-api';
import {
  stockTransactionsApi,
  TRANSACTION_TYPES,
  type ApiStockTransaction,
  type TransactionType,
} from '@/lib/stock-transactions-api';
import { ApiError } from '@/lib/api-client';

/**
 * FR-02: record stock-in/stock-out/wastage against an item, and review the
 * resulting transaction history. Wired to the real backend from the start
 * (GET/POST /stock-transactions) — no mock-data phase for this screen,
 * unlike Items' original pass.
 */
export function StockTransactions() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ApiStockTransaction[]>([]);
  const [items, setItems] = useState<ApiItem[]>([]);

  const [itemFilter, setItemFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionType | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await stockTransactionsApi.list({
        itemId: itemFilter || undefined,
        type: typeFilter || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      });
      setTransactions(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('stock.loadError'));
    } finally {
      setLoading(false);
    }
  }, [itemFilter, typeFilter, dateFrom, dateTo, t]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    itemsApi.list({ isActive: true }).then(setItems).catch(() => setItems([]));
  }, []);

  function handleSaved() {
    setFormOpen(false);
    loadTransactions();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">{t('stock.title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('stock.subtitle')}</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('stock.recordTransaction')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-auto min-w-48" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
          <option value="">{t('stock.filters.allItems')}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.sku})
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TransactionType | '')}
        >
          <option value="">{t('stock.filters.allTypes')}</option>
          {TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`stock.types.${type}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          {t('stock.filters.dateFrom')}
          <Input type="date" className="w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          {t('stock.filters.dateTo')}
          <Input type="date" className="w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
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
          icon={<ClipboardList className="h-7 w-7" />}
          title={t('stock.loadError')}
          description={error}
          action={<Button onClick={loadTransactions}>{t('common.refresh')}</Button>}
        />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title={t('stock.empty.title')}
          description={t('stock.empty.description')}
          action={<Button onClick={() => setFormOpen(true)}>{t('stock.empty.action')}</Button>}
        />
      ) : (
        <StockTransactionsTable transactions={transactions} items={items} />
      )}

      <StockTransactionFormModal open={formOpen} onOpenChange={setFormOpen} items={items} onSaved={handleSaved} />
    </div>
  );
}
