import { AlertStatus, AlertType } from '../constants/enums';

export interface Alert {
  id: string;
  outletId: string;
  /** Null for alerts not about a specific item. */
  itemId: string | null;
  type: AlertType;
  status: AlertStatus;
  message: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}

/** What every alert list actually needs — the item's name, without a
 * round-trip per row. */
export interface AlertWithItem extends Alert {
  itemName: string | null;
}

/**
 * Counts behind FR-17's Global Alert Bar.
 *
 * Spans two modules on purpose: three of the five badges are FR-07 alerts,
 * and the other two are FR-04 states (a PO awaiting approval, a GRN flagged
 * for variance) that have always been real data with no endpoint to read
 * them from. One call rather than three keeps the bar cheap enough to load
 * on every screen.
 */
export interface AlertSummary {
  lowStock: number;
  expiry: number;
  /** Live alerts nobody has acknowledged yet. */
  unacknowledged: number;
  poApprovals: number;
  grnVariance: number;
}
