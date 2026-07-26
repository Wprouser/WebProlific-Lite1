import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { TaxBreakdownDisplay } from '@/components/tax-rates/TaxBreakdownDisplay';
import { EmailComposeModal, type SendEmailValues } from '@/components/documents/EmailComposeModal';
import { grnApi, type ApiGrn } from '@/lib/grn-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { itemsApi, type ApiItem } from '@/lib/items-api';
import { openPdfBlob } from '@/lib/pdf-utils';
import { ApiError } from '@/lib/api-client';

export function GrnDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [grn, setGrn] = useState<ApiGrn | null>(null);
  const [supplier, setSupplier] = useState<ApiSupplier | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await grnApi.get(id);
      setGrn(result);
      const [supplierResult, itemList] = await Promise.all([
        suppliersApi.get(result.supplierId),
        itemsApi.list({}),
      ]);
      setSupplier(supplierResult);
      setItems(itemList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grn.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  function itemName(itemId: string): string {
    return items.find((i) => i.id === itemId)?.name ?? itemId;
  }

  async function handlePrint() {
    if (!grn) return;
    setActionError(null);
    setPrinting(true);
    try {
      const blob = await grnApi.getPdf(grn.id);
      openPdfBlob(blob);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('grn.detail.loadError'));
    } finally {
      setPrinting(false);
    }
  }

  async function handleSendEmail(values: SendEmailValues) {
    if (!grn) return;
    const updated = await grnApi.sendEmail(grn.id, values);
    setGrn(updated);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !grn) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/grn')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('grn.back')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-xl font-semibold text-foreground">
            {t('grn.detail.title', { id: grn.id.slice(0, 8) })}
          </h1>
          {grn.purchaseOrderId ? (
            <Badge variant="info">{t('grn.detail.againstPo')}</Badge>
          ) : (
            <Badge variant="neutral">{t('grn.detail.direct')}</Badge>
          )}
          {grn.varianceFlagged && <Badge variant="warning">{t('grn.detail.varianceFlagged')}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={printing} onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            {t('documents.print')}
          </Button>
          <Button variant="outline" onClick={() => setEmailOpen(true)}>
            <Mail className="h-4 w-4" />
            {t('documents.email.action')}
          </Button>
        </div>
      </div>

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {grn.lastEmailedAt && (
        <p className="text-xs text-foreground-muted">
          {t('documents.email.lastSent', {
            date: new Date(grn.lastEmailedAt).toLocaleString(),
            recipient: grn.lastEmailedTo,
          })}
        </p>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.detail.supplier')}
            </p>
            <p className="mt-1 text-sm text-foreground">{supplier?.name ?? grn.supplierId}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.form.currency')}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {grn.currencyCode}
              {Number(grn.exchangeRateToBase) !== 1 && (
                <span className="text-foreground-muted"> (1 {grn.currencyCode} = {grn.exchangeRateToBase})</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('grn.form.invoiceNumber')}
            </p>
            <p className="mt-1 text-sm text-foreground">{grn.invoiceNumber ?? '—'}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">{t('grn.lines.item')}</th>
              {grn.purchaseOrderId && <th className="px-4 py-3">{t('grn.lines.orderedQty')}</th>}
              <th className="px-4 py-3">{t('grn.lines.receivedQty')}</th>
              <th className="px-4 py-3">{t('grn.lines.actualPrice')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.totals.tax')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.lines.lineTotal')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grn.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">{itemName(line.itemId)}</td>
                {grn.purchaseOrderId && <td className="px-4 py-3 text-foreground-muted">{line.orderedQty ?? '—'}</td>}
                <td className="px-4 py-3">{line.receivedQty}</td>
                <td className="px-4 py-3">
                  {grn.currencyCode} {line.actualPrice}
                </td>
                <td className="px-4 py-3">
                  <TaxBreakdownDisplay
                    lineTaxAmount={line.lineTaxAmount}
                    components={line.taxComponents}
                    currencyCode={grn.currencyCode}
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  {grn.currencyCode} {line.lineTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5 self-end rounded-md border border-border-strong bg-surface-secondary/40 p-4 sm:w-80">
        <div className="flex justify-between text-sm">
          <span className="text-foreground-muted">{t('purchaseOrders.totals.net')}</span>
          <span>{grn.currencyCode} {grn.subtotal}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-foreground-muted">{t('purchaseOrders.totals.tax')}</span>
          <span>{grn.currencyCode} {grn.taxAmount}</span>
        </div>
        {Number(grn.discountAmount) !== 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">{t('purchaseOrders.totals.discount')}</span>
            <span>-{grn.currencyCode} {grn.discountAmount}</span>
          </div>
        )}
        {Number(grn.otherChargesAmount) !== 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">{t('purchaseOrders.totals.otherCharges')}</span>
            <span>{grn.currencyCode} {grn.otherChargesAmount}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
          <span>{t('purchaseOrders.totals.gross')}</span>
          <span>{grn.currencyCode} {grn.totalValue}</span>
        </div>
      </div>

      <EmailComposeModal
        open={emailOpen}
        onOpenChange={setEmailOpen}
        defaultToEmail={supplier?.email ?? ''}
        defaultSubject={t('documents.email.grnDefaultSubject', { id: grn.id.slice(0, 8).toUpperCase() })}
        defaultMessage={t('documents.email.grnDefaultMessage')}
        onSend={handleSendEmail}
      />
    </div>
  );
}
