import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, CheckCircle2, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  salesApi,
  type ApiBatchReview,
  type ApiBatchRunResult,
  type ApiSkippedLine,
} from '@/lib/sales-api';
import { menuItemsApi, type ApiMenuItem } from '@/lib/menu-items-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

/**
 * FR-06 batch import, Steps 2 and 3 — Review, then "Run BOM".
 *
 * They share a screen because they share the data: the confirmation the user
 * gives in step 3 is a confirmation of what step 2 showed them. Splitting
 * them across routes would mean either re-fetching the projection or asking
 * them to commit to numbers on a previous page.
 */
export function SalesImportReview() {
  const { batchId } = useParams<{ batchId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const outletId = getSession()?.user.effectiveOutletIds[0];

  // Handed over by the upload step; only present on the first render after
  // uploading, which is the only time it's meaningful.
  const skippedLines = (location.state as { skippedLines?: ApiSkippedLine[] } | null)?.skippedLines ?? [];

  const [review, setReview] = useState<ApiBatchReview | null>(null);
  const [menuItems, setMenuItems] = useState<ApiMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ApiBatchRunResult | null>(null);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setReview(await salesApi.reviewBatch(batchId));
      if (outletId) setMenuItems(await menuItemsApi.list({ outletId }).catch(() => []));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sales.import.loadError'));
    } finally {
      setLoading(false);
    }
  }, [batchId, outletId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(rowId: string, menuItemId: string) {
    if (!batchId || !menuItemId) return;
    try {
      await salesApi.assignRow(batchId, rowId, menuItemId);
      // Reload rather than patching locally: correcting a row changes the
      // projected impact too, and a stale preview is exactly what this
      // screen exists to prevent.
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sales.import.assignError'));
    }
  }

  async function run() {
    if (!batchId) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await salesApi.runBatch(batchId));
      setConfirming(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sales.import.runError'));
      setConfirming(false);
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!review) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title={t('sales.import.loadError')}
        description={error ?? ''}
        action={<Button onClick={load}>{t('common.refresh')}</Button>}
      />
    );
  }

  const alreadyRun = review.batch.status !== 'STAGED';
  const totalProjected = review.projectedImpact.length;
  const shortfalls = review.projectedImpact.filter((impact) => Number(impact.projectedStock) < 0);

  return (
    <div className="flex flex-col gap-5">
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
        <p className="mt-1 text-sm text-foreground-muted">
          {review.batch.fileName} · {t('sales.import.stepReview')}
        </p>
      </div>

      {result && (
        <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {t('sales.import.completed', {
              processed: result.processedRows,
              skipped: result.skippedRows,
            })}
          </p>
          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-warning">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {skippedLines.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">{t('sales.import.skippedLines', { lineCount: skippedLines.length })}</p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {skippedLines.map((line) => (
              <li key={line.lineNumber}>
                {t('sales.import.skippedLine', { line: line.lineNumber, reason: line.reason })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-foreground">
                {t('sales.import.rows')}
              </h2>
              <span className="flex gap-1.5">
                <Badge variant="success">{t('sales.import.matched', { rowCount: review.matchedCount })}</Badge>
                {review.unmatchedCount > 0 && (
                  <Badge variant="warning">
                    {t('sales.import.unmatched', { rowCount: review.unmatchedCount })}
                  </Badge>
                )}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <tr>
                    <th className="py-2">{t('sales.import.columns.fromFile')}</th>
                    <th className="py-2">{t('sales.columns.quantity')}</th>
                    <th className="py-2">{t('sales.columns.date')}</th>
                    <th className="py-2">{t('sales.import.columns.matchedTo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {review.rows.map((row) => (
                    <tr key={row.id} className={row.matchedMenuItemId ? undefined : 'bg-warning/5'}>
                      <td className="py-2">{row.rawMenuItemName}</td>
                      <td className="py-2">{row.quantitySold}</td>
                      <td className="py-2 text-foreground-muted">
                        {new Date(row.saleDate).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        {alreadyRun ? (
                          <span className="text-foreground-muted">
                            {row.matchedMenuItemName ?? t('sales.import.noMatch')}
                            {row.skipReason && (
                              <span className="block text-xs text-warning">{row.skipReason}</span>
                            )}
                          </span>
                        ) : (
                          // Inline picker, so a bad match never requires
                          // re-uploading the whole file.
                          <Select
                            aria-label={t('sales.import.matchFor', { name: row.rawMenuItemName })}
                            value={row.matchedMenuItemId ?? ''}
                            onChange={(e) => assign(row.id, e.target.value)}
                            className="h-10 text-sm"
                          >
                            <option value="">{t('sales.import.noMatch')}</option>
                            {menuItems.map((menuItem) => (
                              <option key={menuItem.id} value={menuItem.id}>
                                {menuItem.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t('sales.import.impactTitle')}
            </h2>
            <p className="text-sm text-foreground-muted">{t('sales.import.impactExplainer')}</p>

            {review.unmappedMenuItemIds.length > 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                {t('sales.import.impactIncomplete', { itemCount: review.unmappedMenuItemIds.length })}
              </p>
            )}

            {totalProjected === 0 ? (
              <p className="text-sm text-foreground-muted">{t('sales.import.impactEmpty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <tr>
                    <th className="py-2">{t('menuItems.columns.ingredient')}</th>
                    <th className="py-2 text-end">{t('sales.import.columns.deduct')}</th>
                    <th className="py-2 text-end">{t('sales.import.columns.after')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {review.projectedImpact.map((impact) => (
                    <tr key={impact.itemId}>
                      <td className="py-2">{impact.itemName}</td>
                      <td className="py-2 text-end">-{impact.quantity}</td>
                      <td
                        className={`py-2 text-end ${
                          Number(impact.projectedStock) < 0 ? 'font-medium text-warning' : ''
                        }`}
                      >
                        {impact.projectedStock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!alreadyRun && (
              <Button className="mt-2 w-full" onClick={() => setConfirming(true)} disabled={running}>
                <PlayCircle className="h-4 w-4" />
                {t('sales.import.runBom')}
              </Button>
            )}
            {alreadyRun && (
              <Badge variant={review.batch.status === 'COMPLETED' ? 'success' : 'warning'}>
                {t(`sales.import.status.${review.batch.status}`)}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t('sales.import.confirmTitle')}
        description={t('sales.import.confirmDescription')}
      >
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-foreground-muted">{t('sales.import.confirmRows')}</dt>
              <dd className="font-medium">{review.matchedCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-foreground-muted">{t('sales.import.confirmIngredients')}</dt>
              <dd className="font-medium">{totalProjected}</dd>
            </div>
            {review.unmatchedCount > 0 && (
              <div className="flex justify-between text-warning">
                <dt>{t('sales.import.confirmSkipped')}</dt>
                <dd className="font-medium">{review.unmatchedCount}</dd>
              </div>
            )}
          </dl>

          {shortfalls.length > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              {t('sales.import.confirmShortfall', { itemCount: shortfalls.length })}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={running}>
              {t('sales.import.cancel')}
            </Button>
            <Button onClick={run} disabled={running}>
              {running ? t('sales.import.running') : t('sales.import.runBom')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
