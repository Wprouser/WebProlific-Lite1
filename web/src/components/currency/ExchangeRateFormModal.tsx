import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { exchangeRatesApi } from '@/lib/exchange-rates-api';
import { type ApiCurrency } from '@/lib/currencies-api';
import { ApiError } from '@/lib/api-client';

export interface ExchangeRateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currencies: ApiCurrency[];
  /** Pre-selected as the default Base Currency — the overwhelmingly common
   * case is recording a rate FROM the outlet's own base currency. Still a
   * free choice via the dropdown, since ExchangeRate itself is global. */
  defaultBaseCurrency: string;
  onSaved: () => void;
}

/**
 * FR-16: ExchangeRate rows are append-only/historical — "updating" a rate
 * means saving a new row with a later effectiveDate (defaulted server-side
 * to now()); there is no in-place edit. The list always reflects whichever
 * row is latest per pair, so this form only ever creates.
 */
export function ExchangeRateFormModal({
  open,
  onOpenChange,
  currencies,
  defaultBaseCurrency,
  onSaved,
}: ExchangeRateFormModalProps) {
  const { t } = useTranslation();
  const [baseCurrency, setBaseCurrency] = useState(defaultBaseCurrency);
  const [targetCurrency, setTargetCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBaseCurrency(defaultBaseCurrency);
    setTargetCurrency('');
    setRate('');
  }, [open, defaultBaseCurrency]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await exchangeRatesApi.create({ baseCurrency, targetCurrency, rate });
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
    <Modal open={open} onOpenChange={onOpenChange} title={t('currency.rateForm.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('currency.form.baseCurrency')}</span>
          <Select required value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('currency.form.targetCurrency')}</span>
          <Select required value={targetCurrency} onChange={(e) => setTargetCurrency(e.target.value)}>
            <option value="">{t('currency.form.targetCurrencyPlaceholder')}</option>
            {currencies
              .filter((c) => c.code !== baseCurrency)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('currency.form.rate')}</span>
          <Input
            required
            type="number"
            step="0.000001"
            min="0"
            value={rate}
            placeholder={t('currency.form.ratePlaceholder')}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('currency.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !targetCurrency}>
            {saving ? t('currency.form.saving') : t('currency.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
