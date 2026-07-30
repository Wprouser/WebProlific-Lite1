import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { PurchaseOrderLineItemsEditor } from '@/components/purchase-orders/PurchaseOrderLineItemsEditor';
import { purchaseOrdersApi, type POLineInput } from '@/lib/purchase-orders-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { itemsApi, unitsApi, type ApiItem, type ApiUnitOfMeasure } from '@/lib/items-api';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { currenciesApi, type ApiCurrency } from '@/lib/currencies-api';
import { outletsApi } from '@/lib/outlets-api';
import { previewDocumentTotals, previewLineTax } from '@/lib/document-tax-preview';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

const compactFieldClassName = 'h-10 px-3 text-sm';

function CompactInput(props: InputProps) {
  return <Input {...props} className={cn(compactFieldClassName, props.className)} />;
}

function CompactSelect(props: SelectProps) {
  return <Select {...props} className={cn(compactFieldClassName, props.className)} />;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

/** FR-04's Purchase Order create/edit form — one page handles both
 * `/purchase-orders/new` and `/purchase-orders/:id/edit` (DRAFT-only). */
export function PurchaseOrderForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [units, setUnits] = useState<ApiUnitOfMeasure[]>([]);
  const [taxRates, setTaxRates] = useState<ApiTaxRate[]>([]);
  const [currencies, setCurrencies] = useState<ApiCurrency[]>([]);
  const [outletBaseCurrency, setOutletBaseCurrency] = useState('SAR');

  const [supplierId, setSupplierId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('SAR');
  const [exchangeRateToBase, setExchangeRateToBase] = useState('1');
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0.00');
  const [otherChargesAmount, setOtherChargesAmount] = useState('0.00');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [lines, setLines] = useState<POLineInput[]>([{ itemId: '', orderedQty: '', expectedPrice: '' }]);

  const load = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    setError(null);
    try {
      const [supplierList, itemList, unitList, taxRateList, currencyList, settings] = await Promise.all([
        suppliersApi.list({ outletId, isActive: true }),
        itemsApi.list({ isActive: true }),
        unitsApi.list({ outletId }),
        taxRatesApi.list({ isActive: true }),
        currenciesApi.list(),
        outletsApi.getCurrencySettings(outletId),
      ]);
      setSuppliers(supplierList);
      setItems(itemList);
      setUnits(unitList);
      setTaxRates(taxRateList);
      setCurrencies(currencyList);
      setOutletBaseCurrency(settings.baseCurrency);
      setCurrencyCode((prev) => prev || settings.baseCurrency);

      if (id) {
        const po = await purchaseOrdersApi.get(id);
        if (po.status !== 'DRAFT') {
          setError(t('purchaseOrders.form.notDraftError'));
          return;
        }
        setSupplierId(po.supplierId);
        setCurrencyCode(po.currencyCode);
        setExchangeRateToBase(po.exchangeRateToBase);
        setIsTaxInclusive(po.isTaxInclusive);
        setDiscountAmount(po.discountAmount);
        setOtherChargesAmount(po.otherChargesAmount);
        setExpectedDeliveryDate(po.expectedDeliveryDate ? po.expectedDeliveryDate.slice(0, 10) : '');
        setLines(
          po.lines.map((l) => ({
            itemId: l.itemId,
            orderedQty: l.orderedQty,
            expectedPrice: l.expectedPrice,
            taxRateId: l.taxRateId ?? undefined,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('purchaseOrders.form.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, outletId, t]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSupplierChange(newSupplierId: string) {
    setSupplierId(newSupplierId);
    const supplier = suppliers.find((s) => s.id === newSupplierId);
    if (supplier?.preferredCurrency) setCurrencyCode(supplier.preferredCurrency);
  }

  async function handleSave() {
    if (!outletId) return;
    setError(null);
    setSaving(true);
    try {
      const payload = {
        supplierId,
        currencyCode,
        exchangeRateToBase: currencyCode === outletBaseCurrency ? undefined : exchangeRateToBase,
        isTaxInclusive,
        discountAmount,
        otherChargesAmount,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        lines,
      };
      const saved = id
        ? await purchaseOrdersApi.update(id, payload)
        : await purchaseOrdersApi.create({ outletId, ...payload });
      navigate(`/purchase-orders/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('purchaseOrders.form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  const totals = previewDocumentTotals(
    lines.map((line) => {
      const taxRate = taxRates.find((r) => r.id === line.taxRateId) ?? null;
      return previewLineTax(line.orderedQty || '0', line.expectedPrice || '0', taxRate, isTaxInclusive);
    }),
    discountAmount || '0',
    otherChargesAmount || '0',
  );

  const showExchangeRate = currencyCode !== outletBaseCurrency;
  const showDiscountLine = Number(discountAmount || 0) !== 0;
  const showOtherChargesLine = Number(otherChargesAmount || 0) !== 0;

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => navigate('/purchase-orders')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('purchaseOrders.back')}
      </button>

      <h1 className="font-display text-xl font-semibold text-foreground">
        {isEdit ? t('purchaseOrders.form.editTitle') : t('purchaseOrders.form.createTitle')}
      </h1>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('purchaseOrders.form.supplier')}>
              <CompactSelect value={supplierId} onChange={(e) => handleSupplierChange(e.target.value)}>
                <option value="">{t('purchaseOrders.form.supplierPlaceholder')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </CompactSelect>
            </Field>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{t('purchaseOrders.form.currency')}</span>
              <div className="flex items-center gap-2">
                <Badge variant="info">{currencyCode}</Badge>
                <CompactSelect className="flex-1" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </CompactSelect>
              </div>
            </div>
          </div>

          {showExchangeRate && (
            <Field label={t('purchaseOrders.form.exchangeRate', { from: currencyCode, to: outletBaseCurrency })}>
              <CompactInput
                type="number"
                step="0.000001"
                min="0"
                className="max-w-48"
                value={exchangeRateToBase}
                onChange={(e) => setExchangeRateToBase(e.target.value)}
              />
              <span className="text-xs text-foreground-muted">{t('purchaseOrders.form.exchangeRateHint')}</span>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('purchaseOrders.form.expectedDeliveryDate')}>
              <CompactInput
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </Field>

            <label className="flex items-center gap-2.5 rounded-md border border-border-strong p-2.5">
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

          <PurchaseOrderLineItemsEditor
            items={items}
            units={units}
            taxRates={taxRates}
            lines={lines}
            onChange={setLines}
            isTaxInclusive={isTaxInclusive}
            currencyCode={currencyCode}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('purchaseOrders.form.discount')}>
              <CompactInput
                type="number"
                step="0.01"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
              />
            </Field>

            <Field label={t('purchaseOrders.form.otherCharges')}>
              <CompactInput
                type="number"
                step="0.01"
                min="0"
                value={otherChargesAmount}
                onChange={(e) => setOtherChargesAmount(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-border-strong bg-surface-secondary/40 p-3 sm:w-80 sm:self-end">
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

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => navigate('/purchase-orders')}>
              {t('purchaseOrders.form.cancel')}
            </Button>
            <Button disabled={saving || !supplierId} onClick={handleSave}>
              {saving ? t('purchaseOrders.form.saving') : t('purchaseOrders.form.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
