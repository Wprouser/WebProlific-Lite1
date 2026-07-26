import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { itemsApi, type ApiItem } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';

export interface CloneItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ApiItem;
  onCloned: (clone: ApiItem) => void;
}

/**
 * FR-01: "Clone Item" — a new item pre-filled from an existing one, SKU
 * cleared for the user to set (must be unique). Its own small dialog
 * (rather than reusing ItemFormModal) since the only input needed is the
 * new SKU — every other field is copied server-side.
 */
export function CloneItemDialog({ open, onOpenChange, item, onCloned }: CloneItemDialogProps) {
  const { t } = useTranslation();
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSku('');
    setError(null);
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const clone = await itemsApi.clone(item.id, sku);
      onCloned(clone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.cloneDialog.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('items.detail.cloneDialog.title')}
      description={t('items.detail.cloneDialog.description')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('items.detail.cloneDialog.newSku')}</span>
          <Input
            required
            autoFocus
            value={sku}
            placeholder={t('items.detail.cloneDialog.newSkuPlaceholder')}
            onChange={(e) => setSku(e.target.value)}
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('items.detail.cloneDialog.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !sku.trim()}>
            {saving ? t('items.detail.cloneDialog.cloning') : t('items.detail.cloneDialog.clone')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
