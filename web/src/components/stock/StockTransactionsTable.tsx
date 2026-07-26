import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/ResponsiveTable';
import type { ApiItem } from '@/lib/items-api';
import { isInboundTransactionType, type ApiStockTransaction } from '@/lib/stock-transactions-api';

export interface StockTransactionsTableProps {
  transactions: ApiStockTransaction[];
  /** Needed to render "Name (SKU)" per row — omit (with hideItemColumn) when
   * every row is already scoped to one known item, e.g. an Item Detail
   * screen's Transactions tab. */
  items?: ApiItem[];
  hideItemColumn?: boolean;
}

/**
 * Table rendering shared by the standalone /stock screen and an item's own
 * Transactions tab (FR-01's Item Detail Screen) — factored out of
 * StockTransactions.tsx so both consume identical columns/formatting
 * instead of two copies drifting apart.
 */
export function StockTransactionsTable({ transactions, items, hideItemColumn }: StockTransactionsTableProps) {
  const { t } = useTranslation();

  const itemName = (itemId: string) => {
    const item = items?.find((i) => i.id === itemId);
    return item ? `${item.name} (${item.sku})` : itemId;
  };

  const columns: ResponsiveTableColumn<ApiStockTransaction>[] = [
    {
      key: 'createdAt',
      header: t('stock.table.date'),
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
    ...(hideItemColumn
      ? []
      : [
          {
            key: 'item',
            header: t('stock.table.item'),
            render: (row: ApiStockTransaction) => itemName(row.itemId),
          } satisfies ResponsiveTableColumn<ApiStockTransaction>,
        ]),
    {
      key: 'type',
      header: t('stock.table.type'),
      render: (row) => (
        <Badge variant={isInboundTransactionType(row.type) ? 'success-solid' : 'danger-solid'}>
          {t(`stock.types.${row.type}`)}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: t('stock.table.quantity'),
      render: (row) => (isInboundTransactionType(row.type) ? '+' : '−') + row.quantity,
    },
    {
      key: 'balanceAfter',
      header: t('stock.table.balanceAfter'),
      render: (row) => row.balanceAfter,
    },
    {
      key: 'reasonCode',
      header: t('stock.table.reasonCode'),
      render: (row) => (row.reasonCode ? t(`stock.reasonCodes.${row.reasonCode}`) : '—'),
    },
  ];

  return <ResponsiveTable columns={columns} data={transactions} getRowKey={(row) => row.id} />;
}
