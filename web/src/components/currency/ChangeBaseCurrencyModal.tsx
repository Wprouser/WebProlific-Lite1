import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { outletsApi, type ApiOutletCurrencySettings } from '@/lib/outlets-api';
import { type ApiCurrency } from '@/lib/currencies-api';
import { ApiError } from '@/lib/api-client';

export interface ChangeBaseCurrencyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outletId: string;
  currentSettings: ApiOutletCurrencySettings;
  currencies: ApiCurrency[];
  onSaved: () => void;
}

/**
 * FR-16's "heavily restricted" base-currency change — CHAIN_OWNER only
 * (gated at the screen level, not here) and blocked with a 409 once the
 * outlet has any transactional history. That 409 message is written
 * server-side to already be clean, plain-language copy (see
 * OutletsService.updateCurrencySettings), so it's shown verbatim here —
 * unlike a 403, there's no role name or UUID to leak.
 */
export function ChangeBaseCurrencyModal({
  open,
  onOpenChange,
  outletId,
  currentSettings,
  currencies,
  onSaved,
}: ChangeBaseCurrencyModalProps) {
  const { t } = useTranslation();
  const [baseCurrency, setBaseCurrency] = useState(currentSettings.baseCurrency);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBaseCurrency(currentSettings.baseCurrency);
  }, [open, currentSettings]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await outletsApi.updateCurrencySettings(outletId, baseCurrency);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t('currency.form.permissionError'));
      } else {
        setError(err instanceof ApiError ? err.message : t('currency.form.saveError'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('currency.changeBaseCurrency.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-foreground-muted">{t('currency.changeBaseCurrency.description')}</p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('currency.form.baseCurrency')}</span>
          <Select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('currency.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('currency.form.saving') : t('currency.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
