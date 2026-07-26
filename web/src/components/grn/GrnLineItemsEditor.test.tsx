import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GrnLineItemsEditor } from './GrnLineItemsEditor';
import type { ApiItem } from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';
import type { GrnLineInput } from '@/lib/grn-api';

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

function renderEditor(lines: GrnLineInput[], onChange = vi.fn(), lockItemSelection = false) {
  render(
    <GrnLineItemsEditor
      items={items}
      taxRates={taxRates}
      lines={lines}
      onChange={onChange}
      isTaxInclusive={false}
      currencyCode="SAR"
      lockItemSelection={lockItemSelection}
    />,
  );
  return onChange;
}

describe('GrnLineItemsEditor', () => {
  it('shows current stock inline once an item is selected (Direct flow)', () => {
    renderEditor([{ itemId: 'i1', receivedQty: '', actualPrice: '' }]);
    expect(screen.getByText('Current stock: 42.500 KG')).toBeInTheDocument();
  });

  it('computes a live line total from received qty, price, and tax rate', () => {
    renderEditor([{ itemId: 'i1', receivedQty: '2', actualPrice: '10.00', taxRateId: 't1' }]);
    expect(screen.getByText('SAR 21.00')).toBeInTheDocument();
  });

  it('adds a new blank line when Add Line is clicked (Direct flow)', async () => {
    const onChange = renderEditor([{ itemId: 'i1', receivedQty: '1', actualPrice: '5.00' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Line' }));
    expect(onChange).toHaveBeenCalledWith([
      { itemId: 'i1', receivedQty: '1', actualPrice: '5.00' },
      { itemId: '', receivedQty: '', actualPrice: '' },
    ]);
  });

  it('AC: Against-a-PO flow locks the item picker and shows the ordered quantity read-only', () => {
    renderEditor(
      [{ itemId: 'i1', orderedQty: '20.000', receivedQty: '18', actualPrice: '87.00', taxRateId: 't1' }],
      vi.fn(),
      true,
    );
    expect(screen.queryByRole('combobox', { name: /item/i })).not.toBeInTheDocument();
    expect(screen.getByText('Basmati Rice')).toBeInTheDocument();
    expect(screen.getByText('20.000')).toBeInTheDocument();
  });

  it('does not show an Add Line button when the item picker is locked', () => {
    renderEditor([{ itemId: 'i1', orderedQty: '20.000', receivedQty: '18', actualPrice: '87.00' }], vi.fn(), true);
    expect(screen.queryByRole('button', { name: 'Add Line' })).not.toBeInTheDocument();
  });

  it('removes a line when its remove button is clicked, but not the last remaining line', async () => {
    const onChange = renderEditor([
      { itemId: 'i1', receivedQty: '1', actualPrice: '5.00' },
      { itemId: '', receivedQty: '', actualPrice: '' },
    ]);
    const removeButtons = screen.getAllByLabelText('Remove line');
    expect(removeButtons).toHaveLength(2);
    await userEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([{ itemId: '', receivedQty: '', actualPrice: '' }]);
  });
});
