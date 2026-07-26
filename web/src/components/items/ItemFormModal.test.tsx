import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ItemFormModal } from './ItemFormModal';
import { itemsApi, itemImagesApi, type ApiCategory, type ApiItem } from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';

vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, create: vi.fn(), update: vi.fn() },
    itemImagesApi: {
      ...actual.itemImagesApi,
      list: vi.fn().mockResolvedValue([]),
      upload: vi.fn(),
    },
  };
});

const categories: ApiCategory[] = [{ id: 'c1', name: 'Dry Goods', outletId: 'o1' }];
const taxRates: ApiTaxRate[] = [
  { id: 'tax-vat', outletId: 'o1', name: 'VAT 15%', ratePercent: '15.00', isCompound: false, isDefault: false, isActive: true, countryCode: 'SA', components: [] },
  { id: 'tax-zero', outletId: 'o1', name: 'Zero-Rated', ratePercent: '0.00', isCompound: false, isDefault: false, isActive: true, countryCode: null, components: [] },
  { id: 'tax-old', outletId: 'o1', name: 'Old GST', ratePercent: '5.00', isCompound: false, isDefault: false, isActive: false, countryCode: null, components: [] },
];

const existingItem: ApiItem = {
  id: 'i1',
  outletId: 'o1',
  name: 'Basmati Rice',
  categoryId: 'c1',
  sku: 'RICE-BAS-001',
  barcode: null,
  unit: 'KG',
  minStock: '10',
  maxStock: '100',
  currentStock: '0',
  shelfLifeDays: null,
  costPrice: '85.50',
  defaultSupplierId: null,
  purchaseGLAccount: null,
  defaultTaxRateId: null,
  storageLocation: null,
  isActive: true,
};

// Sequential, not Promise.all — concurrent userEvent interactions share
// focus/selection state under the hood and corrupt each other's input.
async function fillMinimumCreateFields() {
  await userEvent.type(screen.getByPlaceholderText('e.g. Basmati Rice'), 'Sugar');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Category/i }), 'c1');
  await userEvent.type(screen.getByPlaceholderText('e.g. RICE-BAS-001'), 'SUGAR-001');
  await userEvent.type(screen.getByLabelText(/Min stock/i), '1');
  await userEvent.type(screen.getByLabelText(/Max stock/i), '10');
  await userEvent.type(screen.getByLabelText(/Cost price/i), '5');
}

describe('ItemFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (itemImagesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe('create mode', () => {
    it('renders a staged image picker (no itemId exists yet to attach a real image to)', () => {
      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={null}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );
      expect(screen.getByText('Images')).toBeInTheDocument();
      expect(screen.getByText('No images yet')).toBeInTheDocument();
      // Nothing fetched from the real image API in create mode.
      expect(itemImagesApi.list).not.toHaveBeenCalled();
    });

    it('AC: never offers an inactive tax rate for a brand-new item', () => {
      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={null}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );
      expect(screen.queryByRole('option', { name: /Old GST/ })).not.toBeInTheDocument();
    });

    it('AC: staged images are uploaded to the new item right after creation succeeds', async () => {
      const created = { ...existingItem, id: 'new-item-id', name: 'Sugar', sku: 'SUGAR-001' };
      (itemsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      (itemImagesApi.upload as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const onSaved = vi.fn();

      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={null}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={onSaved}
        />,
      );

      await fillMinimumCreateFields();

      const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(fileInput, file);
      expect(screen.getByText('Primary')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Save item' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(itemsApi.create).toHaveBeenCalled();
      expect(itemImagesApi.upload).toHaveBeenCalledWith('new-item-id', file);
    });

    it('a failed staged-image upload does not block the item from being reported as saved', async () => {
      const created = { ...existingItem, id: 'new-item-id', name: 'Sugar', sku: 'SUGAR-001' };
      (itemsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      (itemImagesApi.upload as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network blip'));
      const onSaved = vi.fn();

      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={null}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={onSaved}
        />,
      );

      await fillMinimumCreateFields();

      const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(fileInput, file);

      await userEvent.click(screen.getByRole('button', { name: 'Save item' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('AC: selecting a tax rate persists its id on create', async () => {
      const created = { ...existingItem, id: 'new-item-id', name: 'Sugar', sku: 'SUGAR-001' };
      (itemsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      const onSaved = vi.fn();

      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={null}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={onSaved}
        />,
      );

      await fillMinimumCreateFields();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: /Default tax rate/i }), 'tax-vat');
      await userEvent.click(screen.getByRole('button', { name: 'Save item' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(itemsApi.create).toHaveBeenCalledWith(expect.objectContaining({ defaultTaxRateId: 'tax-vat' }));
    });
  });

  describe('edit mode', () => {
    it('loads and renders the real image gallery for the existing item', async () => {
      (itemImagesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'img1', itemId: 'i1', url: '/uploads/items/i1/one.png', isPrimary: true, sortOrder: 0, createdAt: '' },
      ]);

      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={existingItem}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );

      await waitFor(() => expect(itemImagesApi.list).toHaveBeenCalledWith('i1'));
      expect(await screen.findByText('Primary')).toBeInTheDocument();
    });

    it('pre-selects the item\'s existing default tax rate', () => {
      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={{ ...existingItem, defaultTaxRateId: 'tax-zero' }}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );

      expect(screen.getByRole('combobox', { name: /Default tax rate/i })).toHaveValue('tax-zero');
    });

    it('AC: preserves and labels an already-selected inactive tax rate instead of hiding it', () => {
      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={{ ...existingItem, defaultTaxRateId: 'tax-old' }}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );

      const select = screen.getByRole('combobox', { name: /Default tax rate/i });
      expect(select).toHaveValue('tax-old');
      expect(screen.getByRole('option', { name: 'Old GST (Inactive)' })).toBeInTheDocument();
    });

    it('AC: does not offer an inactive rate that is not this item\'s current selection', () => {
      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={{ ...existingItem, defaultTaxRateId: 'tax-vat' }}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={vi.fn()}
        />,
      );

      expect(screen.queryByRole('option', { name: /Old GST/ })).not.toBeInTheDocument();
    });

    it('AC: updating an item persists a changed tax rate selection', async () => {
      (itemsApi.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingItem, defaultTaxRateId: 'tax-vat' });
      const onSaved = vi.fn();

      render(
        <ItemFormModal
          open
          onOpenChange={vi.fn()}
          item={existingItem}
          categories={categories}
          taxRates={taxRates}
          outletId="o1"
          onSaved={onSaved}
        />,
      );

      await userEvent.selectOptions(screen.getByRole('combobox', { name: /Default tax rate/i }), 'tax-vat');
      await userEvent.click(screen.getByRole('button', { name: 'Save item' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(itemsApi.update).toHaveBeenCalledWith('i1', expect.objectContaining({ defaultTaxRateId: 'tax-vat' }));
    });
  });
});
