import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ScanLine, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { GrnLineItemsEditor } from '@/components/grn/GrnLineItemsEditor';
import { invoiceScansApi, type ApiInvoiceScan } from '@/lib/invoice-scans-api';
import { grnApi, type GrnLineInput } from '@/lib/grn-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { itemsApi, unitsApi, type ApiItem, type ApiUnitOfMeasure } from '@/lib/items-api';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { previewDocumentTotals, previewLineTax } from '@/lib/document-tax-preview';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

const POLL_INTERVAL_MS = 700;
const MAX_POLL_ATTEMPTS = 30;

/**
 * FR-04's GRN Flow 3 (AI-04 Scan Invoice). Upload -> async PROCESSING ->
 * EXTRACTED, then the extracted data always pre-fills this review form —
 * every field stays editable, and nothing is submitted until the user
 * explicitly confirms, at which point it's created via the same
 * POST /grn/direct as Flow 1 (see InvoiceScan's backend schema comment for
 * why scanning is a separate resource from GRN itself).
 */
export function ScanInvoiceGrnForm() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [units, setUnits] = useState<ApiUnitOfMeasure[]>([]);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);
  const [referenceDataLoaded, setReferenceDataLoaded] = useState(false);

  const [scan, setScan] = useState<ApiInvoiceScan | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0.00');
  const [otherChargesAmount, setOtherChargesAmount] = useState('0.00');
  const [lines, setLines] = useState<GrnLineInput[]>([]);

  useEffect(() => {
    if (!outletId) return;
    Promise.all([
      suppliersApi.list({ outletId, isActive: true }),
      itemsApi.list({ isActive: true }),
      unitsApi.list({ outletId }),
      taxRatesApi.list({ isActive: true }),
    ])
      .then(([supplierList, itemList, unitList, taxRateList]) => {
        setSuppliers(supplierList);
        setItems(itemList);
        setUnits(unitList);
        setTaxRates(taxRateList);
      })
      .finally(() => setReferenceDataLoaded(true));
  }, [outletId]);

  const pollStatus = useCallback(async (scanId: string) => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const result = await invoiceScansApi.getStatus(scanId);
      if (result.status !== 'PROCESSING') return result;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(t('grn.scan.timeoutError'));
  }, [t]);

  async function handleFileSelected(file: File) {
    if (!outletId) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await invoiceScansApi.upload(outletId, file);
      const settled = await pollStatus(uploaded.id);
      setScan(settled);
      if (settled.status === 'EXTRACTED' && settled.extractedData) {
        setInvoiceNumber(settled.extractedData.invoiceNumber ?? '');
        setSupplierId(settled.extractedData.matchedSupplierId ?? '');
        setLines(
          settled.extractedData.lines.map((line) => ({
            itemId: line.matchedItemId ?? '',
            receivedQty: line.quantity,
            actualPrice: line.unitPrice,
          })),
        );
      } else if (settled.status === 'FAILED') {
        setError(settled.failureReason ?? t('grn.scan.failedError'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grn.scan.failedError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!outletId || !scan) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await grnApi.createDirect({
        outletId,
        supplierId,
        invoiceNumber: invoiceNumber || undefined,
        invoiceScanId: scan.id,
        isTaxInclusive,
        discountAmount,
        otherChargesAmount,
        lines,
      });
      navigate(`/grn/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grn.form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  const totals = previewDocumentTotals(
    lines.map((line) => {
      const taxRate = taxRates.find((r) => r.id === line.taxRateId) ?? null;
      return previewLineTax(line.receivedQty || '0', line.actualPrice || '0', taxRate, isTaxInclusive);
    }),
    discountAmount || '0',
    otherChargesAmount || '0',
  );

  const showDiscountLine = Number(discountAmount || 0) !== 0;
  const showOtherChargesLine = Number(otherChargesAmount || 0) !== 0;

  const currencyCode = suppliers.find((s) => s.id === supplierId)?.preferredCurrency ?? 'SAR';

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/grn/new')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('grn.back')}
      </button>

      <h1 className="font-display text-xl font-semibold text-foreground">{t('grn.new.scan.title')}</h1>

      {!scan ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center">
          {uploading ? (
            <>
              <Skeleton className="h-10 w-10 rounded-full" />
              <p className="text-sm text-foreground-muted">{t('grn.scan.processing')}</p>
            </>
          ) : (
            <>
              <ScanLine className="h-8 w-8 text-primary" />
              <p className="text-sm text-foreground-muted">{t('grn.scan.uploadPrompt')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                <UploadCloud className="h-4 w-4" />
                {t('grn.scan.uploadAction')}
              </Button>
              {error && <p className="text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      ) : scan.status === 'FAILED' ? (
        <EmptyState
          icon={<ScanLine className="h-7 w-7" />}
          title={t('grn.scan.failedTitle')}
          description={error ?? scan.failureReason ?? t('grn.scan.failedError')}
          action={
            <Button
              onClick={() => {
                setScan(null);
                setError(null);
              }}
            >
              {t('grn.scan.retryAction')}
            </Button>
          }
        />
      ) : !referenceDataLoaded ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-foreground-muted">{t('grn.scan.reviewHint')}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('purchaseOrders.form.supplier')}</span>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('purchaseOrders.form.supplierPlaceholder')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {scan.extractedData?.supplierNameGuess && !supplierId && (
                <span className="text-xs text-warning">
                  {t('grn.scan.supplierUnmatched', { guess: scan.extractedData.supplierNameGuess })}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('grn.form.invoiceNumber')}</span>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </label>
          </div>

          <label className="flex items-center gap-2.5 rounded-md border border-border-strong p-3.5">
            <input
              type="checkbox"
              checked={isTaxInclusive}
              onChange={(e) => setIsTaxInclusive(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm text-foreground-muted">
              <span className="block font-medium text-foreground">{t('purchaseOrders.form.taxInclusiveToggle')}</span>
              {t('purchaseOrders.form.taxInclusiveHint')}
            </span>
          </label>

          <GrnLineItemsEditor
            items={items}
            units={units}
            taxRates={taxRates}
            lines={lines}
            onChange={setLines}
            isTaxInclusive={isTaxInclusive}
            currencyCode={currencyCode}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('purchaseOrders.form.discount')}</span>
              <Input type="number" step="0.01" min="0" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t('purchaseOrders.form.otherCharges')}</span>
              <Input type="number" step="0.01" min="0" value={otherChargesAmount} onChange={(e) => setOtherChargesAmount(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-1.5 rounded-md border border-border-strong bg-surface-secondary/40 p-4 sm:w-80 sm:self-end">
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">{t('purchaseOrders.totals.net')}</span>
              <span>{currencyCode} {totals.subtotal}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">{t('purchaseOrders.totals.tax')}</span>
              <span>{currencyCode} {totals.taxAmount}</span>
            </div>
            {showDiscountLine && (
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">{t('purchaseOrders.totals.discount')}</span>
                <span>-{currencyCode} {Number(discountAmount || 0).toFixed(2)}</span>
              </div>
            )}
            {showOtherChargesLine && (
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">{t('purchaseOrders.totals.otherCharges')}</span>
                <span>{currencyCode} {Number(otherChargesAmount || 0).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
              <span>{t('purchaseOrders.totals.gross')}</span>
              <span>{currencyCode} {totals.totalValue}</span>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => navigate('/grn')}>
              {t('purchaseOrders.form.cancel')}
            </Button>
            <Button disabled={saving || !supplierId || lines.length === 0} onClick={handleConfirm}>
              {saving ? t('purchaseOrders.form.saving') : t('grn.scan.confirmAction')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
