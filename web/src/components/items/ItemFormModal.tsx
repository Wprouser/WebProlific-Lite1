import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import {
  itemImagesApi,
  itemsApi,
  type ApiCategory,
  type ApiItem,
  type ApiItemImage,
  type Unit,
} from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';
import { ApiError } from '@/lib/api-client';
import { ItemImageGallery } from './ItemImageGallery';
import { StagedImagePicker } from './StagedImagePicker';

const UNITS: Unit[] = ['KG', 'LITRE', 'PIECE', 'BOX', 'GRAM', 'ML'];

// This form has grown well past the handful of fields Input/Select's
// shared h-12 touch-target sizing was chosen for (see Button.tsx's own
// comment on that) — compacted locally via className override rather than
// changing those shared components, which are also used by touch-first
// screens (Login, Items filters) that still want the taller default.
const compactFieldClassName = 'h-10 px-3 text-sm';

function CompactInput(props: InputProps) {
  return <Input {...props} className={cn(compactFieldClassName, props.className)} />;
}

function CompactSelect(props: SelectProps) {
  return <Select {...props} className={cn(compactFieldClassName, props.className)} />;
}

export interface ItemFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create; an item = edit that item. */
  item: ApiItem | null;
  categories: ApiCategory[];
  taxRates: ApiTaxRate[];
  /** The outlet new items are created under — undefined if the session has no accessible outlet. */
  outletId: string | undefined;
  onSaved: () => void;
}

interface FormState {
  name: string;
  categoryId: string;
  sku: string;
  barcode: string;
  unit: Unit;
  minStock: string;
  maxStock: string;
  shelfLifeDays: string;
  costPrice: string;
  defaultSupplierId: string;
  purchaseGLAccount: string;
  defaultTaxRateId: string;
  storageLocation: string;
  openingQuantity: string;
  openingRatePerUnit: string;
}

function emptyForm(defaultCategoryId: string): FormState {
  return {
    name: '',
    categoryId: defaultCategoryId,
    sku: '',
    barcode: '',
    unit: 'KG',
    minStock: '',
    maxStock: '',
    shelfLifeDays: '',
    costPrice: '',
    defaultSupplierId: '',
    purchaseGLAccount: '',
    defaultTaxRateId: '',
    storageLocation: '',
    openingQuantity: '',
    openingRatePerUnit: '',
  };
}

/** FR-01's create/edit item form, as a Modal rather than a dedicated route — keeps the user on the list
 * (create) or lets the Item Detail Screen open it in edit mode without navigating away. */
export function ItemFormModal({
  open,
  onOpenChange,
  item,
  categories,
  taxRates,
  outletId,
  onSaved,
}: ItemFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => emptyForm(categories[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit mode: images already exist server-side, loaded for the real
  // itemId. Create mode: no itemId yet, so picks are staged client-side
  // (see StagedImagePicker) and uploaded right after the item is created.
  const [images, setImages] = useState<ApiItemImage[]>([]);
  const [stagedImages, setStagedImages] = useState<File[]>([]);

  // FR-04 spec: "a deactivated rate simply stops appearing in the dropdown
  // for new lines" — so a brand-new item only ever offers active rates.
  // But if this item *already* has an inactive rate as its default, that
  // selection must stay visible (labeled inactive) rather than silently
  // vanishing or falling back to showing a raw id.
  const availableTaxRates = taxRates.filter((rate) => rate.isActive || rate.id === item?.defaultTaxRateId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStagedImages([]);
    setForm(
      item
        ? {
            name: item.name,
            categoryId: item.categoryId,
            sku: item.sku,
            barcode: item.barcode ?? '',
            unit: item.unit,
            minStock: item.minStock,
            maxStock: item.maxStock,
            shelfLifeDays: item.shelfLifeDays != null ? String(item.shelfLifeDays) : '',
            costPrice: item.costPrice ?? '',
            defaultSupplierId: item.defaultSupplierId ?? '',
            purchaseGLAccount: item.purchaseGLAccount ?? '',
            defaultTaxRateId: item.defaultTaxRateId ?? '',
            storageLocation: item.storageLocation ?? '',
            openingQuantity: '',
            openingRatePerUnit: '',
          }
        : emptyForm(categories[0]?.id ?? ''),
    );
  }, [open, item, categories]);

  useEffect(() => {
    if (!open || !item) {
      setImages([]);
      return;
    }
    itemImagesApi.list(item.id).then(setImages).catch(() => setImages([]));
  }, [open, item]);

  function reloadImages() {
    if (!item) return;
    itemImagesApi.list(item.id).then(setImages).catch(() => {});
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // AC: cannot set minStock >= maxStock — checked client-side for
    // immediate feedback; the server enforces this independently too.
    if (Number(form.minStock) >= Number(form.maxStock)) {
      setError(t('items.form.errorMinMax'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (item) {
        await itemsApi.update(item.id, {
          name: form.name,
          categoryId: form.categoryId,
          sku: form.sku,
          barcode: form.barcode.trim() || null,
          unit: form.unit,
          minStock: form.minStock,
          maxStock: form.maxStock,
          shelfLifeDays: form.shelfLifeDays.trim() ? Number(form.shelfLifeDays) : null,
          costPrice: form.costPrice,
          defaultSupplierId: form.defaultSupplierId.trim() || null,
          purchaseGLAccount: form.purchaseGLAccount.trim() || null,
          defaultTaxRateId: form.defaultTaxRateId.trim() || null,
          storageLocation: form.storageLocation.trim() || null,
        });
      } else {
        if (!outletId) return;
        const created = await itemsApi.create({
          outletId,
          name: form.name,
          categoryId: form.categoryId,
          sku: form.sku,
          barcode: form.barcode.trim() || null,
          unit: form.unit,
          minStock: form.minStock,
          maxStock: form.maxStock,
          shelfLifeDays: form.shelfLifeDays.trim() ? Number(form.shelfLifeDays) : null,
          costPrice: form.costPrice,
          defaultSupplierId: form.defaultSupplierId.trim() || null,
          purchaseGLAccount: form.purchaseGLAccount.trim() || null,
          defaultTaxRateId: form.defaultTaxRateId.trim() || null,
          storageLocation: form.storageLocation.trim() || null,
          openingStock: form.openingQuantity.trim()
            ? { quantity: form.openingQuantity, ratePerUnit: form.openingRatePerUnit.trim() || undefined }
            : undefined,
        });
        // Best-effort: the item itself is already created successfully at
        // this point, so an image failing to upload shouldn't roll back or
        // block that — images can always be added afterward from the
        // item's detail page. Uploaded sequentially (not Promise.all) so
        // the first staged file reliably lands first and gets the server's
        // "first upload is primary" treatment.
        for (const file of stagedImages) {
          try {
            await itemImagesApi.upload(created.id, file);
          } catch {
            // Swallowed deliberately — see comment above.
          }
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={item ? t('items.form.editTitle') : t('items.form.createTitle')}
      // Wider than Modal's max-w-md default — this form grew well past a
      // handful of fields with FR-01's expansion (GL/tax/opening-stock/
      // images), and max-w-md left the 3-column stock row cramped on every
      // viewport, not just narrow ones.
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <SectionHeading first>{t('items.form.sectionBasics')}</SectionHeading>

        <Field label={t('items.form.name')} required>
          <CompactInput
            required
            value={form.name}
            placeholder={t('items.form.namePlaceholder')}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <Field label={t('items.form.category')} required>
          <CompactSelect
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="" disabled>
              {t('items.form.categoryPlaceholder')}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </CompactSelect>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('items.form.sku')} required>
            <CompactInput
              required
              value={form.sku}
              placeholder={t('items.form.skuPlaceholder')}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </Field>
          <Field label={t('items.form.barcode')}>
            <CompactInput
              value={form.barcode}
              placeholder={t('items.form.barcodePlaceholder')}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </Field>
        </div>

        {/* Divider only, no text — ItemImageGallery/StagedImagePicker
            already render their own "Images" heading (the same one
            ItemDetail's Overview tab relies on), so a SectionHeading here
            would just duplicate that label. */}
        <div className="mt-1 border-t border-border pt-3">
          {item ? (
            <ItemImageGallery itemId={item.id} images={images} onChanged={reloadImages} />
          ) : (
            <StagedImagePicker files={stagedImages} onChange={setStagedImages} />
          )}
        </div>

        <SectionHeading>{t('items.form.sectionStock')}</SectionHeading>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('items.form.unit')}>
            <CompactSelect value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`items.units.${u}`)}
                </option>
              ))}
            </CompactSelect>
          </Field>
          <Field label={t('items.form.minStock')}>
            <CompactInput
              required
              type="number"
              step="0.001"
              min="0"
              value={form.minStock}
              onChange={(e) => setForm({ ...form, minStock: e.target.value })}
            />
          </Field>
          <Field label={t('items.form.maxStock')}>
            <CompactInput
              required
              type="number"
              step="0.001"
              min="0"
              value={form.maxStock}
              onChange={(e) => setForm({ ...form, maxStock: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('items.form.costPrice')}>
            <CompactInput
              required
              type="number"
              step="0.01"
              min="0"
              value={form.costPrice}
              onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
            />
          </Field>
          <Field label={t('items.form.shelfLifeDays')}>
            <CompactInput
              type="number"
              step="1"
              min="0"
              value={form.shelfLifeDays}
              onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })}
            />
          </Field>
        </div>

        <SectionHeading>{t('items.form.sectionAdditional')}</SectionHeading>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('items.form.storageLocation')}>
            <CompactInput
              value={form.storageLocation}
              placeholder={t('items.form.storageLocationPlaceholder')}
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
            />
          </Field>
          <Field label={t('items.form.defaultSupplierId')}>
            <CompactInput
              value={form.defaultSupplierId}
              placeholder={t('items.form.defaultSupplierIdPlaceholder')}
              onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('items.form.purchaseGLAccount')}>
            <CompactInput
              value={form.purchaseGLAccount}
              placeholder={t('items.form.purchaseGLAccountPlaceholder')}
              onChange={(e) => setForm({ ...form, purchaseGLAccount: e.target.value })}
            />
          </Field>
          <Field label={t('items.form.defaultTaxRateId')}>
            <CompactSelect
              value={form.defaultTaxRateId}
              onChange={(e) => setForm({ ...form, defaultTaxRateId: e.target.value })}
            >
              <option value="">{t('items.form.defaultTaxRateIdPlaceholder')}</option>
              {availableTaxRates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.isActive ? rate.name : t('items.form.defaultTaxRateIdInactiveOption', { name: rate.name })}
                </option>
              ))}
            </CompactSelect>
          </Field>
        </div>

        {/* Opening stock — only captured at creation time (spec: "not a
            follow-up call the frontend has to remember to make"); no
            equivalent field exists for edit, since currentStock is never a
            plain editable field. */}
        {!item && (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-secondary/40 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('items.form.openingStockTitle')}</p>
              <p className="text-xs text-foreground-muted">{t('items.form.openingStockHint')}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('items.form.openingQuantity')}>
                <CompactInput
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.openingQuantity}
                  onChange={(e) => setForm({ ...form, openingQuantity: e.target.value })}
                />
              </Field>
              <Field label={t('items.form.openingRatePerUnit')}>
                <CompactInput
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.openingRatePerUnit}
                  onChange={(e) => setForm({ ...form, openingRatePerUnit: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-1 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('items.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving || (!item && !outletId)}>
            {saving ? t('items.form.saving') : t('items.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function SectionHeading({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <h3
      className={
        'text-xs font-semibold uppercase tracking-wide text-foreground-muted ' +
        (first ? '' : 'mt-1 border-t border-border pt-3')
      }
    >
      {children}
    </h3>
  );
}
