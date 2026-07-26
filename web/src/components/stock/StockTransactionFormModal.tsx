import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  stockTransactionsApi,
  TRANSACTION_TYPES,
  REASON_CODES,
  type ReasonCode,
  type TransactionType,
} from '@/lib/stock-transactions-api';
import type { ApiItem } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';

export interface StockTransactionFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ApiItem[];
  /** Preselects the item — e.g. opened from an item's row. */
  defaultItemId?: string;
  onSaved: () => void;
}

interface FormState {
  itemId: string;
  type: TransactionType;
  quantity: string;
  reasonCode: ReasonCode | '';
  forceOverride: boolean;
}

function emptyForm(defaultItemId?: string): FormState {
  return { itemId: defaultItemId ?? '', type: 'PURCHASE_IN', quantity: '', reasonCode: '', forceOverride: false };
}

/**
 * FR-02's create-only stock movement form, as a Modal off the Stock
 * screen — mirrors ItemFormModal's shape. Wired to the real
 * POST /stock-transactions from the start (no mock phase, per FR-01's
 * frontend already having made that transition).
 */
export function StockTransactionFormModal({
  open,
  onOpenChange,
  items,
  defaultItemId,
  onSaved,
}: StockTransactionFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultItemId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(emptyForm(defaultItemId));
  }, [open, defaultItemId]);

  const isWastage = form.type === 'WASTAGE_OUT';
  const isOut = form.type.endsWith('_OUT');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // AC: reasonCode required for WASTAGE_OUT — checked client-side for
    // immediate feedback; the server enforces this independently too.
    if (isWastage && !form.reasonCode) {
      setError(t('stock.form.errorReasonRequired'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await stockTransactionsApi.create({
        itemId: form.itemId,
        type: form.type,
        quantity: form.quantity,
        reasonCode: isWastage ? (form.reasonCode as ReasonCode) : undefined,
        forceOverride: isOut ? form.forceOverride : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('stock.form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('stock.form.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('stock.form.item')}>
          <Select
            required
            value={form.itemId}
            onChange={(e) => setForm({ ...form, itemId: e.target.value })}
          >
            <option value="" disabled>
              {t('stock.form.itemPlaceholder')}
            </option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.sku})
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('stock.form.type')}>
          <Select
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as TransactionType, reasonCode: '', forceOverride: false })
            }
          >
            {TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`stock.types.${type}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('stock.form.quantity')}>
          <Input
            required
            type="number"
            step="0.001"
            min="0.001"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </Field>

        {isWastage && (
          <Field label={t('stock.form.reasonCode')}>
            <Select
              required
              value={form.reasonCode}
              onChange={(e) => setForm({ ...form, reasonCode: e.target.value as ReasonCode })}
            >
              <option value="" disabled>
                {t('stock.form.reasonCodePlaceholder')}
              </option>
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`stock.reasonCodes.${code}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {isOut && (
          <label className="flex items-start gap-2.5 rounded-md border border-border-strong p-3.5">
            <input
              type="checkbox"
              checked={form.forceOverride}
              onChange={(e) => setForm({ ...form, forceOverride: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span className="text-sm text-foreground-muted">
              <span className="block font-medium text-foreground">{t('stock.form.forceOverride')}</span>
              {t('stock.form.forceOverrideHint')}
            </span>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('stock.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !form.itemId}>
            {saving ? t('stock.form.saving') : t('stock.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
