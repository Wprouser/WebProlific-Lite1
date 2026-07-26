import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { GrnLineItemsEditor } from '@/components/grn/GrnLineItemsEditor';
import { grnApi, type GrnLineInput } from '@/lib/grn-api';
import { purchaseOrdersApi, type ApiPurchaseOrder } from '@/lib/purchase-orders-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { itemsApi, type ApiItem } from '@/lib/items-api';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { previewDocumentTotals, previewLineTax } from '@/lib/document-tax-preview';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

const RECEIVABLE_STATUSES: ApiPurchaseOrder['status'][] = ['APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED'];

/**
 * FR-04's GRN Flow 2 — Against a PO. With no `:poId` route param, shows a
 * picker of receivable POs (spec: "filtered to APPROVED, SENT_TO_SUPPLIER,
 * or PARTIALLY_RECEIVED"). Once a PO is chosen — or pre-selected via the
 * route param when arriving from a PO detail page's "Create GRN" button —
 * auto-populates lines from it as editable defaults.
 */
export function PoGrnForm() {
  const { poId } = useParams<{ poId?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [candidatePOs, setCandidatePOs] = useState<ApiPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [po, setPo] = useState<ApiPurchaseOrder | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);

  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0.00');
  const [otherChargesAmount, setOtherChargesAmount] = useState('0.00');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<GrnLineInput[]>([]);

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      const [itemList, taxRateList] = await Promise.all([
        itemsApi.list({ isActive: true }),
        taxRatesApi.list({ isActive: true }),
      ]);
      setItems(itemList);
      setTaxRates(taxRateList);

      if (poId) {
        const selected = await purchaseOrdersApi.get(poId);
        if (!RECEIVABLE_STATUSES.includes(selected.status)) {
          setError(t('grn.poForm.notReceivableError'));
          return;
        }
        const supplierResult = await suppliersApi.get(selected.supplierId);
        setSuppliers([supplierResult]);
        setPo(selected);
        setIsTaxInclusive(selected.isTaxInclusive);
        setLines(
          selected.lines.map((l) => ({
            itemId: l.itemId,
            orderedQty: l.orderedQty,
            receivedQty: (Number(l.orderedQty) - Number(l.receivedQty)).toFixed(3),
            actualPrice: l.expectedPrice,
            taxRateId: l.taxRateId ?? undefined,
          })),
        );
      } else {
        const [allPOs, supplierList] = await Promise.all([
          purchaseOrdersApi.list({ outletId }),
          suppliersApi.list({ outletId }),
        ]);
        setCandidatePOs(allPOs.filter((p) => RECEIVABLE_STATUSES.includes(p.status)));
        setSuppliers(supplierList);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grn.form.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, poId, t]);

  useEffect(() => {
    load();
  }, [load]);

  function supplierName(supplierId: string): string {
    return suppliers.find((s) => s.id === supplierId)?.name ?? supplierId;
  }

  async function handleSave() {
    if (!po) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await grnApi.createAgainstPo(po.id, {
        isTaxInclusive,
        discountAmount,
        otherChargesAmount,
        invoiceNumber: invoiceNumber || undefined,
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

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // No PO chosen yet — show the picker.
  if (!poId) {
    return (
      <div className="flex flex-col gap-5">
        <button
          onClick={() => navigate('/grn/new')}
          className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('grn.back')}
        </button>
        <h1 className="font-display text-xl font-semibold text-foreground">{t('grn.poForm.pickerTitle')}</h1>

        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : candidatePOs.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={t('grn.poForm.pickerEmpty.title')}
            description={t('grn.poForm.pickerEmpty.description')}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="px-4 py-3">{t('purchaseOrders.list.supplier')}</th>
                  <th className="px-4 py-3">{t('purchaseOrders.list.status')}</th>
                  <th className="px-4 py-3">{t('purchaseOrders.list.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidatePOs.map((candidate) => (
                  <tr
                    key={candidate.id}
                    className="cursor-pointer hover:bg-surface-secondary/40"
                    onClick={() => navigate(`/grn/new/po/${candidate.id}`)}
                  >
                    <td className="px-4 py-3">{supplierName(candidate.supplierId)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{t(`purchaseOrders.status.${candidate.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {candidate.currencyCode} {candidate.totalValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (error || !po) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/grn/new/po')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('grn.back')}
      </button>

      <h1 className="font-display text-xl font-semibold text-foreground">{t('grn.new.againstPo.title')}</h1>

      <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.form.supplier')}
            </p>
            <p className="mt-1 text-sm text-foreground">{supplierName(po.supplierId)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.form.currency')}
            </p>
            <p className="mt-1 text-sm text-foreground">
              <Badge variant="info">{po.currencyCode}</Badge>
              {Number(po.exchangeRateToBase) !== 1 && (
                <span className="ms-2 text-foreground-muted">1 {po.currencyCode} = {po.exchangeRateToBase}</span>
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{t('grn.form.invoiceNumber')}</span>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </label>

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
        </div>

        <GrnLineItemsEditor
          items={items}
          taxRates={taxRates}
          lines={lines}
          onChange={setLines}
          isTaxInclusive={isTaxInclusive}
          currencyCode={po.currencyCode}
          lockItemSelection
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
            <span>{po.currencyCode} {totals.subtotal}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">{t('purchaseOrders.totals.tax')}</span>
            <span>{po.currencyCode} {totals.taxAmount}</span>
          </div>
          {showDiscountLine && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">{t('purchaseOrders.totals.discount')}</span>
              <span>-{po.currencyCode} {Number(discountAmount || 0).toFixed(2)}</span>
            </div>
          )}
          {showOtherChargesLine && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">{t('purchaseOrders.totals.otherCharges')}</span>
              <span>{po.currencyCode} {Number(otherChargesAmount || 0).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
            <span>{t('purchaseOrders.totals.gross')}</span>
            <span>{po.currencyCode} {totals.totalValue}</span>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate('/grn')}>
            {t('purchaseOrders.form.cancel')}
          </Button>
          <Button disabled={saving || lines.length === 0} onClick={handleSave}>
            {saving ? t('purchaseOrders.form.saving') : t('purchaseOrders.form.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
