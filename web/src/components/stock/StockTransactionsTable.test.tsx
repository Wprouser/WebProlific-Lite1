import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StockTransactionsTable } from './StockTransactionsTable';
import type { ApiStockTransaction } from '@/lib/stock-transactions-api';
import type { ApiItem } from '@/lib/items-api';

const transactions: ApiStockTransaction[] = [
  {
    id: 't1',
    outletId: 'o1',
    itemId: 'i1',
    type: 'PURCHASE_IN',
    quantity: '10.000',
    balanceAfter: '35.000',
    referenceType: null,
    referenceId: null,
    reasonCode: null,
    photoUrl: null,
    performedById: 'u1',
    createdAt: new Date('2026-07-01').toISOString(),
  },
];

const items: ApiItem[] = [
  {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'RICE-BAS-001',
    barcode: null,
    unit: 'KG',
    minStock: '10',
    maxStock: '100',
    currentStock: '35',
    shelfLifeDays: null,
    costPrice: '85.50',
    defaultSupplierId: null,
    purchaseGLAccount: null,
    defaultTaxRateId: null,
    storageLocation: null,
    isActive: true,
  },
];

describe('StockTransactionsTable', () => {
  it('renders the item column (Name (SKU)) when items are provided and hideItemColumn is not set', () => {
    render(<StockTransactionsTable transactions={transactions} items={items} />);
    expect(screen.getAllByText('Basmati Rice (RICE-BAS-001)').length).toBeGreaterThan(0);
  });

  it('omits the item column entirely when hideItemColumn is set — e.g. an Item Detail Transactions tab', () => {
    render(<StockTransactionsTable transactions={transactions} hideItemColumn />);
    expect(screen.queryByText('Basmati Rice (RICE-BAS-001)')).not.toBeInTheDocument();
    // Still renders the row's other data.
    expect(screen.getAllByText('+10.000').length).toBeGreaterThan(0);
  });

  it('falls back to the raw itemId when items are not provided and the column is shown', () => {
    render(<StockTransactionsTable transactions={transactions} />);
    expect(screen.getAllByText('i1').length).toBeGreaterThan(0);
  });
});
