import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, Pencil, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TaxBreakdownDisplay } from '@/components/tax-rates/TaxBreakdownDisplay';
import { EmailComposeModal, type SendEmailValues } from '@/components/documents/EmailComposeModal';
import { purchaseOrdersApi, type ApiPurchaseOrder } from '@/lib/purchase-orders-api';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { itemsApi, type ApiItem } from '@/lib/items-api';
import { openPdfBlob } from '@/lib/pdf-utils';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

const CREATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'STORE_STAFF'];
const APPROVAL_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'];
// Same set GRN's own createAgainstPo() enforces server-side — a PO can be
// received against while APPROVED, SENT_TO_SUPPLIER, or PARTIALLY_RECEIVED.
const RECEIVABLE_STATUSES = ['APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED'];

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success-solid' | 'danger-solid' | 'warning'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SENT_TO_SUPPLIER: 'info',
  PARTIALLY_RECEIVED: 'warning',
  FULLY_RECEIVED: 'success-solid',
  CLOSED: 'success-solid',
  REJECTED: 'danger-solid',
  CANCELLED: 'danger-solid',
};

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const role = getSession()?.user.effectiveRole ?? '';
  const canCreate = CREATE_ROLES.includes(role);
  const canApprove = APPROVAL_ROLES.includes(role);

  const [po, setPo] = useState<ApiPurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState<ApiSupplier | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [printing, setPrinting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await purchaseOrdersApi.get(id);
      setPo(result);
      const [supplierResult, itemList] = await Promise.all([
        suppliersApi.get(result.supplierId),
        itemsApi.list({}),
      ]);
      setSupplier(supplierResult);
      setItems(itemList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('purchaseOrders.detail.loadError'));
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
    if (!po) return;
    setActionError(null);
    setPrinting(true);
    try {
      const blob = await purchaseOrdersApi.getPdf(po.id);
      openPdfBlob(blob);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('purchaseOrders.detail.actionError'));
    } finally {
      setPrinting(false);
    }
  }

  async function handleSendEmail(values: SendEmailValues) {
    if (!po) return;
    const updated = await purchaseOrdersApi.sendEmail(po.id, values);
    setPo(updated);
  }

  async function runAction(action: () => Promise<ApiPurchaseOrder>) {
    setActionError(null);
    setActing(true);
    try {
      const updated = await action();
      setPo(updated);
      setRejecting(false);
      setRejectReason('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('purchaseOrders.detail.actionError'));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !po) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/purchase-orders')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('purchaseOrders.back')}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl font-semibold text-foreground">
            {t('purchaseOrders.detail.title', { id: po.id.slice(0, 8) })}
          </h1>
          <Badge variant={STATUS_VARIANT[po.status] ?? 'neutral'}>{t(`purchaseOrders.status.${po.status}`)}</Badge>
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
          {po.status === 'DRAFT' && canCreate && (
            <Button variant="outline" onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}>
              <Pencil className="h-4 w-4" />
              {t('purchaseOrders.edit')}
            </Button>
          )}
          {po.status === 'DRAFT' && canCreate && (
            <Button disabled={acting} onClick={() => runAction(() => purchaseOrdersApi.submit(po.id))}>
              {t('purchaseOrders.actions.submit')}
            </Button>
          )}
          {po.status === 'PENDING_APPROVAL' && canApprove && (
            <>
              <Button disabled={acting} onClick={() => runAction(() => purchaseOrdersApi.approve(po.id))}>
                {t('purchaseOrders.actions.approve')}
              </Button>
              <Button variant="danger" disabled={acting} onClick={() => setRejecting(true)}>
                {t('purchaseOrders.actions.reject')}
              </Button>
            </>
          )}
          {po.status === 'APPROVED' && canApprove && (
            <Button disabled={acting} onClick={() => runAction(() => purchaseOrdersApi.send(po.id))}>
              {t('purchaseOrders.actions.send')}
            </Button>
          )}
          {RECEIVABLE_STATUSES.includes(po.status) && canCreate && (
            <Button variant="outline" onClick={() => navigate(`/grn/new?poId=${po.id}`)}>
              {t('purchaseOrders.actions.createGrn')}
            </Button>
          )}
          {po.status === 'PARTIALLY_RECEIVED' && canApprove && (
            <Button disabled={acting} onClick={() => runAction(() => purchaseOrdersApi.close(po.id))}>
              {t('purchaseOrders.actions.close')}
            </Button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger/5 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{t('purchaseOrders.actions.rejectReason')}</span>
            <textarea
              className="min-h-20 rounded-md border border-border-strong bg-surface p-3 text-sm"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              {t('purchaseOrders.form.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={acting || !rejectReason.trim()}
              onClick={() => runAction(() => purchaseOrdersApi.reject(po.id, rejectReason))}
            >
              {t('purchaseOrders.actions.confirmReject')}
            </Button>
          </div>
        </div>
      )}

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {po.lastEmailedAt && (
        <p className="text-xs text-foreground-muted">
          {t('documents.email.lastSent', {
            date: new Date(po.lastEmailedAt).toLocaleString(),
            recipient: po.lastEmailedTo,
          })}
        </p>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.detail.supplier')}
            </p>
            <p className="mt-1 text-sm text-foreground">{supplier?.name ?? po.supplierId}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.form.currency')}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {po.currencyCode}
              {po.currencyCode !== po.currencyCode ? '' : ''}
              {Number(po.exchangeRateToBase) !== 1 && (
                <span className="text-foreground-muted"> (1 {po.currencyCode} = {po.exchangeRateToBase})</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {t('purchaseOrders.detail.expectedDelivery')}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">{t('purchaseOrders.lines.item')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.lines.orderedQty')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.lines.expectedPrice')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.totals.tax')}</th>
              <th className="px-4 py-3">{t('purchaseOrders.lines.lineTotal')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {po.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">{itemName(line.itemId)}</td>
                <td className="px-4 py-3">{line.orderedQty}</td>
                <td className="px-4 py-3">
                  {po.currencyCode} {line.expectedPrice}
                </td>
                <td className="px-4 py-3">
                  <TaxBreakdownDisplay
                    lineTaxAmount={line.lineTaxAmount}
                    components={line.taxComponents}
                    currencyCode={po.currencyCode}
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  {po.currencyCode} {line.lineTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5 self-end rounded-md border border-border-strong bg-surface-secondary/40 p-4 sm:w-80">
        <div className="flex justify-between text-sm">
          <span className="text-foreground-muted">{t('purchaseOrders.totals.net')}</span>
          <span>{po.currencyCode} {po.subtotal}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-foreground-muted">{t('purchaseOrders.totals.tax')}</span>
          <span>{po.currencyCode} {po.taxAmount}</span>
        </div>
        {Number(po.discountAmount) !== 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">{t('purchaseOrders.totals.discount')}</span>
            <span>-{po.currencyCode} {po.discountAmount}</span>
          </div>
        )}
        {Number(po.otherChargesAmount) !== 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">{t('purchaseOrders.totals.otherCharges')}</span>
            <span>{po.currencyCode} {po.otherChargesAmount}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
          <span>{t('purchaseOrders.totals.gross')}</span>
          <span>{po.currencyCode} {po.totalValue}</span>
        </div>
      </div>

      <EmailComposeModal
        open={emailOpen}
        onOpenChange={setEmailOpen}
        defaultToEmail={supplier?.email ?? ''}
        defaultSubject={t('documents.email.poDefaultSubject', { id: po.id.slice(0, 8).toUpperCase() })}
        defaultMessage={t('documents.email.poDefaultMessage')}
        showDraftWarning={po.status === 'DRAFT'}
        onSend={handleSendEmail}
      />
    </div>
  );
}
