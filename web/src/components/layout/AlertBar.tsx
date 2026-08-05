import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { alertsApi, type ApiAlertSummary } from '@/lib/alerts-api';
import { getSession } from '@/lib/auth-store';
import { cn } from '@/lib/cn';

// Pastel-tinted, not solid-fill — refined status pills rather than loud
// ones, while the amber/red hue families still keep severities distinct.
const severityClasses: Record<'warning' | 'danger', string> = {
  warning: 'bg-warning/15 text-warning hover:bg-warning/25',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

/** The five badges, in display order, mapped onto the summary endpoint.
 * `type` doubles as the /alerts/:type route segment and the i18n key, which
 * is why these stay kebab-case rather than matching the API's enum casing. */
const BADGES: {
  type: string;
  severity: 'warning' | 'danger';
  count: (summary: ApiAlertSummary) => number;
}[] = [
  { type: 'low-stock', severity: 'warning', count: (s) => s.lowStock },
  { type: 'expiry', severity: 'warning', count: (s) => s.expiry },
  { type: 'po-approvals', severity: 'warning', count: (s) => s.poApprovals },
  { type: 'grn-variance', severity: 'danger', count: (s) => s.grnVariance },
  { type: 'unacknowledged', severity: 'danger', count: (s) => s.unacknowledged },
];

/**
 * FR-17 Global App Chrome, Global Alert Bar: "sourced directly from FR-07
 * (Alerts) and FR-04's variance-approval workflow... each badge shows a
 * count and is clickable, jumping straight to the filtered list." Now real
 * — FR-07 exists, and its summary endpoint answers for FR-04's two states
 * as well. Collapses to a single summary chip below `tablet:` — five
 * separate badges don't fit a phone width without cramming, and a chef
 * mid-service needs "something needs attention, tap here," not five
 * simultaneous labels.
 *
 * A badge showing zero is hidden rather than rendered as "0": the bar sits
 * on every screen, and five permanent zeroes is furniture people stop
 * reading.
 */
export function AlertBar() {
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];
  const [summary, setSummary] = useState<ApiAlertSummary | null>(null);

  const load = useCallback(() => {
    alertsApi
      .summary(outletId)
      // A failed count must not break the app chrome wrapped around every
      // screen — the bar simply shows nothing.
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const badges = summary
    ? BADGES.map((badge) => ({ ...badge, value: badge.count(summary) })).filter((b) => b.value > 0)
    : [];
  const total = badges.reduce((sum, badge) => sum + badge.value, 0);
  const mostUrgent = badges.find((badge) => badge.severity === 'danger') ?? badges[0];

  return (
    <div className="border-b border-border bg-surface px-5 py-2 tablet:px-8">
      <div className="tablet:hidden">
        {total === 0 || !mostUrgent ? (
          <span className="text-sm text-foreground-muted">{t('alerts.none')}</span>
        ) : (
          <Link
            to={`/alerts/${mostUrgent.type}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200',
              severityClasses[mostUrgent.severity],
            )}
          >
            <Bell className="h-3.5 w-3.5" />
            {t('alerts.needAttention', { min: total })}
          </Link>
        )}
      </div>

      <div className="hidden flex-wrap items-center gap-2 tablet:flex">
        {total === 0 ? (
          <span className="text-sm text-foreground-muted">{t('alerts.none')}</span>
        ) : (
          badges.map((badge) => (
            <Link
              key={badge.type}
              to={`/alerts/${badge.type}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200',
                severityClasses[badge.severity],
              )}
            >
              {t(`alerts.${badge.type}`)} <span className="font-semibold">{badge.value}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
