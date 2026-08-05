import { AlertType } from '../constants/enums';

/**
 * FR-07's stock-threshold rule, as a pure function over two decimal strings.
 *
 * Split out from the service for the usual reason in this codebase: the
 * boundary cases (exactly at minimum, exactly zero, a negative balance from
 * an FR-06 oversell) are arithmetic, and arithmetic is cheaper to test
 * directly than through a repository.
 *
 * Returns the type to raise, or null when stock is healthy — which is also
 * the signal to auto-resolve any live alert for that item.
 */
export function evaluateStockLevel(currentStock: string, minStock: string): AlertType | null {
  const current = Number(currentStock);
  const minimum = Number(minStock);

  // A malformed number must not silently read as 0 and alert on everything.
  if (!Number.isFinite(current) || !Number.isFinite(minimum)) return null;

  // Negative is reachable: FR-06 records an oversell rather than refusing it,
  // so "below zero" is a real state and is still out of stock, not a
  // separate condition.
  if (current <= 0) return 'OUT_OF_STOCK';

  // At the minimum, not just below it: minStock is the level at which you
  // are meant to reorder, so hitting it exactly is the moment to say so.
  if (current <= minimum) return 'LOW_STOCK';

  return null;
}

/**
 * FR-07 spec: "estimate expiry from last PURCHASE_IN transaction date +
 * shelf life, and raise EXPIRY_WARNING if within expiryAlertLeadDays".
 *
 * Returns the estimated expiry date, or null when the item can't have one —
 * no shelf life recorded, or nothing ever received.
 */
export function estimateExpiry(lastPurchaseInAt: Date | null, shelfLifeDays: number | null): Date | null {
  if (!lastPurchaseInAt || shelfLifeDays === null || shelfLifeDays <= 0) return null;
  const expiry = new Date(lastPurchaseInAt.getTime());
  expiry.setUTCDate(expiry.getUTCDate() + shelfLifeDays);
  return expiry;
}

/**
 * Whether an estimated expiry falls inside the warning window.
 *
 * Deliberately true for a date already in the past: stock that expired
 * yesterday is more urgent than stock expiring tomorrow, and treating "days
 * remaining < 0" as out of range would silently drop exactly the cases that
 * matter most.
 */
export function isWithinExpiryWindow(expiry: Date, now: Date, leadDays: number): boolean {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = (expiry.getTime() - now.getTime()) / msPerDay;
  return daysRemaining <= leadDays;
}
