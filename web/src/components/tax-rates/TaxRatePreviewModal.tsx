import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TaxBreakdownDisplay } from './TaxBreakdownDisplay';
import { taxRatesApi, type ApiTaxRate, type TaxRatePreviewResult } from '@/lib/tax-rates-api';
import { ApiError } from '@/lib/api-client';

export interface TaxRatePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxRate: ApiTaxRate | null;
}

/**
 * Demo/calculation-check tool, not a real transaction — there's no real
 * PO/GRN line to apply a tax rate to yet (FR-03/04 aren't built), so this
 * lets you enter a sample amount and see exactly what FR-04's real line
 * calculation will produce later: Net/Tax/Gross, with an itemized
 * component breakdown for compound rates.
 */
export function TaxRatePreviewModal({ open, onOpenChange, taxRate }: TaxRatePreviewModalProps) {
  const { t } = useTranslation();
  const [subtotal, setSubtotal] = useState('');
  const [result, setResult] = useState<TaxRatePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubtotal('');
    setResult(null);
    setError(null);
  }, [open, taxRate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!taxRate) return;
    setError(null);
    setLoading(true);
    try {
      const preview = await taxRatesApi.preview(taxRate.id, subtotal);
      setResult(preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('taxRates.preview.error'));
    } finally {
      setLoading(false);
    }
  }

  if (!taxRate) return null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('taxRates.preview.title', { name: taxRate.name })}
      description={t('taxRates.preview.description')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('taxRates.preview.subtotal')}</span>
          <Input
            required
            type="number"
            step="0.01"
            min="0"
            value={subtotal}
            onChange={(e) => setSubtotal(e.target.value)}
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? t('taxRates.preview.calculating') : t('taxRates.preview.calculate')}
          </Button>
        </div>

        {result && (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-secondary/40 p-3.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground-muted">{t('taxRates.preview.net')}</span>
              <span className="font-medium text-foreground">{result.lineSubtotal}</span>
            </div>
            <div className="flex items-start justify-between gap-4 text-sm">
              <span className="text-foreground-muted">{t('taxRates.preview.taxLabel')}</span>
              <TaxBreakdownDisplay lineTaxAmount={result.lineTaxAmount} components={result.components} />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
              <span className="font-semibold text-foreground-muted">{t('taxRates.preview.gross')}</span>
              <span className="font-semibold text-foreground">{result.lineTotal}</span>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
