import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseOrderLineItemsEditor } from './PurchaseOrderLineItemsEditor';
import type { ApiItem } from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';
import type { POLineInput } from '@/lib/purchase-orders-api';

const items: ApiItem[] = [
  {
    id: 'i1',
    outletId: 'o1',
    name: 'Basmati Rice',
    categoryId: 'c1',
    sku: 'SKU-1',
    barcode: null,
    unit: 'KG',
    minStock: '10',
    maxStock: '100',
    currentStock: '42.500',
    shelfLifeDays: null,
    defaultSupplierId: null,
    purchaseGLAccount: null,
    defaultTaxRateId: null,
    storageLocation: null,
    isActive: true,
  },
];

const taxRates: ApiTaxRate[] = [
  { id: 't1', outletId: 'o1', name: 'GST 5%', ratePercent: '5', isCompound: false, isDefault: false, isActive: true, countryCode: null, components: [] },
];

function renderEditor(lines: POLineInput[], onChange = vi.fn()) {
  render(
    <PurchaseOrderLineItemsEditor
      items={items}
      taxRates={taxRates}
      lines={lines}
      onChange={onChange}
      isTaxInclusive={false}
      currencyCode="SAR"
    />,
  );
  return onChange;
}

describe('PurchaseOrderLineItemsEditor', () => {
  it('shows current stock inline once an item is selected', async () => {
    renderEditor([{ itemId: 'i1', orderedQty: '', expectedPrice: '' }]);
    expect(screen.getByText('Current stock: 42.500 KG')).toBeInTheDocument();
  });

  it('does not show current stock before an item is selected', () => {
    renderEditor([{ itemId: '', orderedQty: '', expectedPrice: '' }]);
    expect(screen.queryByText(/Current stock:/)).not.toBeInTheDocument();
  });

  it('computes a live line total from qty, price, and tax rate', () => {
    renderEditor([{ itemId: 'i1', orderedQty: '2', expectedPrice: '10.00', taxRateId: 't1' }]);
    // 2 * 10.00 = 20.00 subtotal, +5% tax = 21.00 total
    expect(screen.getByText('SAR 21.00')).toBeInTheDocument();
  });

  it('adds a new blank line when Add Line is clicked', async () => {
    const onChange = renderEditor([{ itemId: 'i1', orderedQty: '1', expectedPrice: '5.00' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Line' }));
    expect(onChange).toHaveBeenCalledWith([
      { itemId: 'i1', orderedQty: '1', expectedPrice: '5.00' },
      { itemId: '', orderedQty: '', expectedPrice: '' },
    ]);
  });

  it('removes a line when its remove button is clicked, but not the last remaining line', async () => {
    const onChange = renderEditor([
      { itemId: 'i1', orderedQty: '1', expectedPrice: '5.00' },
      { itemId: '', orderedQty: '', expectedPrice: '' },
    ]);
    const removeButtons = screen.getAllByLabelText('Remove line');
    expect(removeButtons).toHaveLength(2);
    await userEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([{ itemId: '', orderedQty: '', expectedPrice: '' }]);
  });

  it('disables remove when only one line remains', () => {
    renderEditor([{ itemId: '', orderedQty: '', expectedPrice: '' }]);
    expect(screen.getByLabelText('Remove line')).toBeDisabled();
  });
});
