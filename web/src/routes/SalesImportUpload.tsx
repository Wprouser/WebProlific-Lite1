import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import {
  DEFAULT_SALES_DATE_FORMAT,
  SALES_DATE_FORMATS,
  salesApi,
  type SalesDateFormat,
} from '@/lib/sales-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * FR-06 batch import, Step 1 — Upload.
 *
 * A full page, not a modal, per the established pattern for multi-step
 * data-heavy flows (PO/GRN). Nothing here touches stock: submitting stages a
 * batch and moves to the review step.
 */
export function SalesImportUpload() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [file, setFile] = useState<File | null>(null);
  const [dateFormat, setDateFormat] = useState<SalesDateFormat>(DEFAULT_SALES_DATE_FORMAT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || !outletId) return;
    setSubmitting(true);
    setError(null);
    try {
      const staged = await salesApi.uploadBatch(outletId, file, dateFormat);
      navigate(`/sales/import/${staged.batch.id}`, { state: { skippedLines: staged.skippedLines } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sales.import.uploadError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex max-w-2xl flex-col gap-5" onSubmit={handleSubmit}>
      <div>
        <button
          type="button"
          onClick={() => navigate('/sales')}
          className="mb-2 flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('sales.import.backToSales')}
        </button>
        <h1 className="font-display text-xl font-semibold text-foreground">{t('sales.import.title')}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{t('sales.import.stepUpload')}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sales-file" className="text-sm font-medium text-foreground">
              {t('sales.import.fileLabel')}
            </label>
            <input
              id="sales-file"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:me-3 file:rounded-full file:border-0 file:bg-surface-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground"
            />
          </div>

          {/* Stated by the uploader, not inferred from the data: 03/04/2026
              is 3 April or 4 March depending on where the file came from, and
              nothing in it says which. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="date-format" className="text-sm font-medium text-foreground">
              {t('sales.import.dateFormatLabel')}
            </label>
            <Select
              id="date-format"
              className="max-w-xs"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as SalesDateFormat)}
            >
              {SALES_DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`sales.import.dateFormat.${format}`)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-foreground-muted">{t('sales.import.dateFormatHint')}</p>
          </div>

          <div className="rounded-lg border border-border bg-surface-secondary/40 px-4 py-3 text-sm text-foreground-muted">
            <p className="font-medium text-foreground">{t('sales.import.formatTitle')}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>{t('sales.import.formatColumns')}</li>
              <li>{t('sales.import.formatOptional')}</li>
            </ul>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={!file || submitting}>
              <Upload className="h-4 w-4" />
              {submitting ? t('sales.import.uploading') : t('sales.import.continue')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
