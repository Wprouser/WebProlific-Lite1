import { Alert, AlertSummary, AlertWithItem } from '../domain/alert.entity';
import { AlertStatus, AlertType } from '../constants/enums';

export interface CreateAlertInput {
  outletId: string;
  itemId: string | null;
  type: AlertType;
  message: string;
}

export interface AlertFilters {
  accessibleOutletIds: string[];
  outletId?: string;
  status?: AlertStatus;
  type?: AlertType;
}

/** Items the nightly expiry scan has to consider: a shelf life is set, and
 * there is stock on hand worth warning about. */
export interface ExpiryCandidate {
  itemId: string;
  outletId: string;
  itemName: string;
  shelfLifeDays: number;
  currentStock: string;
  /** Newest PURCHASE_IN for this item, or null if never received. */
  lastPurchaseInAt: Date | null;
}

export abstract class AlertRepository {
  abstract create(input: CreateAlertInput): Promise<Alert>;
  abstract findById(id: string): Promise<Alert | null>;
  abstract findScoped(filters: AlertFilters): Promise<AlertWithItem[]>;

  /**
   * The dedup lookup: is there already a live alert of this type for this
   * item, raised since `since`?
   *
   * Both OPEN and ACKNOWLEDGED count — acknowledging means "seen", not
   * "fixed", so a second identical alert would still be noise.
   */
  abstract findLiveAlert(itemId: string, type: AlertType, since: Date): Promise<Alert | null>;

  abstract updateStatus(
    id: string,
    status: AlertStatus,
    timestamps: { acknowledgedAt?: Date; resolvedAt?: Date },
  ): Promise<Alert>;

  /**
   * Closes every live stock alert for an item in one statement — used when
   * stock recovers above its minimum. Returns how many were closed, so the
   * caller can tell "nothing to do" from "actually resolved something".
   */
  abstract resolveLiveStockAlerts(itemId: string, resolvedAt: Date): Promise<number>;

  abstract findExpiryCandidates(): Promise<ExpiryCandidate[]>;
  abstract summarize(accessibleOutletIds: string[], outletId?: string): Promise<AlertSummary>;
}
