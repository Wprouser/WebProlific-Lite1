import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ALERT_REPOSITORY } from '../repositories/tokens';
import { AlertRepository } from '../repositories/alert.repository';
import { Alert, AlertSummary, AlertWithItem } from '../domain/alert.entity';
import {
  ALERT_MUTATE_ROLES,
  AlertType,
  DEFAULT_ALERT_COOLDOWN_HOURS,
  DEFAULT_EXPIRY_ALERT_LEAD_DAYS,
} from '../constants/enums';
import { estimateExpiry, evaluateStockLevel, isWithinExpiryWindow } from '../lib/evaluate-stock-level';
import { ITEM_REPOSITORY } from '../../items/repositories/tokens';
import { ItemRepository } from '../../items/repositories/item.repository';
import { PurchaseOrdersService } from '../../purchase-orders/services/purchase-orders.service';
import { PurchaseOrder } from '../../purchase-orders/domain/purchase-order.entity';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { Role } from '../../tenancy/constants/enums';
import { QueryAlertsDto } from '../dto/query-alerts.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(ALERT_REPOSITORY) private readonly alertRepository: AlertRepository,
    @Inject(ITEM_REPOSITORY) private readonly itemRepository: ItemRepository,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly activityBus: ActivityBus,
    private readonly config: ConfigService,
  ) {}

  private get cooldownHours(): number {
    return Number(this.config.get('ALERT_COOLDOWN_HOURS')) || DEFAULT_ALERT_COOLDOWN_HOURS;
  }

  private get expiryLeadDays(): number {
    return Number(this.config.get('EXPIRY_ALERT_LEAD_DAYS')) || DEFAULT_EXPIRY_ALERT_LEAD_DAYS;
  }

  /**
   * Reacts to one stock movement: raise, ignore, or auto-resolve.
   *
   * Called from the `item.stock.changed` listener, which FR-02 emits
   * fire-and-forget — so everything here runs outside the stock-transaction
   * request's await path, which is what the spec's "decoupled" acceptance
   * criterion asks for.
   */
  async evaluateItemStock(input: {
    itemId: string;
    outletId: string;
    itemName: string;
    currentStock: string;
    minStock: string;
  }): Promise<Alert | null> {
    const type = evaluateStockLevel(input.currentStock, input.minStock);

    if (!type) {
      // Stock recovered. Not in the spec, but without this every alert has
      // to be closed by hand and the alert bar never empties on its own —
      // which trains people to ignore it.
      const resolved = await this.alertRepository.resolveLiveStockAlerts(input.itemId, new Date());
      if (resolved > 0) {
        this.logger.log(`Item ${input.itemId} recovered — resolved ${resolved} stock alert(s)`);
      }
      return null;
    }

    return this.raise(input.outletId, input.itemId, type, describeStock(input, type));
  }

  /**
   * Creates an alert unless an equivalent one is already live.
   *
   * Dedup is a read-then-write, per the spec's rule. With a single
   * in-process listener the events for one item serialise through one
   * handler, so the window only opens across instances — and the worst case
   * there is a duplicate alert, not incorrect stock. SQL Server can't
   * express a partial unique index through Prisma, so there is no constraint
   * to lean on instead; this is stated rather than papered over.
   */
  async raise(
    outletId: string,
    itemId: string | null,
    type: AlertType,
    message: string,
  ): Promise<Alert | null> {
    if (itemId) {
      const since = new Date(Date.now() - this.cooldownHours * 60 * 60 * 1000);
      const existing = await this.alertRepository.findLiveAlert(itemId, type, since);
      if (existing) return null;
    }

    const alert = await this.alertRepository.create({ outletId, itemId, type, message });

    // No userId: nothing here is user-initiated. ActivityLog.userId is
    // nullable for exactly this ("system-generated events").
    await this.activityBus.record({
      category: 'ALERT',
      action: `ALERT_${type}`,
      entityType: 'Alert',
      entityId: alert.id,
      outletId,
      descriptionKey: `activity.alert.${type.toLowerCase()}`,
      metadata: { itemId, message },
    });

    return alert;
  }

  /**
   * The nightly expiry scan. Returns how many alerts it raised, which is
   * what the job logs.
   */
  async scanForExpiringStock(now = new Date()): Promise<number> {
    const candidates = await this.alertRepository.findExpiryCandidates();
    let raised = 0;

    for (const candidate of candidates) {
      const expiry = estimateExpiry(candidate.lastPurchaseInAt, candidate.shelfLifeDays);
      if (!expiry || !isWithinExpiryWindow(expiry, now, this.expiryLeadDays)) continue;

      const expired = expiry.getTime() < now.getTime();
      const alert = await this.raise(
        candidate.outletId,
        candidate.itemId,
        'EXPIRY_WARNING',
        expired
          ? `${candidate.itemName} is estimated to have expired on ${formatDate(expiry)} ` +
            `(${candidate.currentStock} still on hand).`
          : `${candidate.itemName} is estimated to expire on ${formatDate(expiry)} ` +
            `(${candidate.currentStock} on hand).`,
      );
      if (alert) raised++;
    }

    return raised;
  }

  // ------------------------------------------------------------------- reads

  async list(request: RequestWithAccess, query: QueryAlertsDto): Promise<AlertWithItem[]> {
    return this.alertRepository.findScoped({
      accessibleOutletIds: request.effectiveAccess!.effectiveOutletIds,
      outletId: query.outletId,
      status: query.status,
      type: query.type,
    });
  }

  /** Counts behind FR-17's Global Alert Bar. */
  async summarize(request: RequestWithAccess, outletId?: string): Promise<AlertSummary> {
    return this.alertRepository.summarize(
      request.effectiveAccess!.effectiveOutletIds,
      outletId,
    );
  }

  // --------------------------------------------------------------- mutations

  async acknowledge(request: RequestWithAccess, id: string): Promise<Alert> {
    const alert = await this.getForMutation(request, id);
    // Acknowledging a resolved alert would un-resolve it, which is not what
    // anyone means by the button.
    if (alert.status !== 'OPEN') return alert;
    return this.alertRepository.updateStatus(id, 'ACKNOWLEDGED', { acknowledgedAt: new Date() });
  }

  async resolve(request: RequestWithAccess, id: string): Promise<Alert> {
    const alert = await this.getForMutation(request, id);
    if (alert.status === 'RESOLVED') return alert;
    return this.alertRepository.updateStatus(id, 'RESOLVED', { resolvedAt: new Date() });
  }

  /**
   * FR-07's reorder shortcut: a DRAFT PO pre-filled with the alerting item,
   * quantity `maxStock - currentStock`.
   *
   * Delegates to PurchaseOrdersService rather than assembling a PO here, so
   * currency resolution, tax and totals stay in one place.
   */
  async createPoDraft(request: RequestWithAccess, id: string): Promise<PurchaseOrder> {
    const alert = await this.getForMutation(request, id);
    if (!alert.itemId) {
      throw new BadRequestException('This alert is not about a specific item, so it cannot start a PO.');
    }

    const item = await this.itemRepository.findById(alert.itemId);
    if (!item) throw new NotFoundException(`Item ${alert.itemId} not found`);

    if (!item.defaultSupplierId) {
      // Naming the item matters: the fix is to set a default supplier on
      // that item, and a generic "supplier required" would not say which.
      throw new BadRequestException(
        `"${item.name}" has no default supplier, so a purchase order can't be pre-filled. ` +
          'Set one on the item, or raise the PO manually.',
      );
    }

    const orderedQty = suggestedOrderQuantity(item.maxStock, item.currentStock);
    if (Number(orderedQty) <= 0) {
      throw new BadRequestException(
        `"${item.name}" is already at or above its maximum stock level, so there is nothing to order.`,
      );
    }

    return this.purchaseOrdersService.create(request, {
      outletId: alert.outletId,
      supplierId: item.defaultSupplierId,
      lines: [
        {
          itemId: item.id,
          orderedQty,
          // The item's own cost price is the only price this shortcut can
          // know; the draft exists to be reviewed and edited before sending.
          expectedPrice: item.costPrice,
          taxRateId: item.defaultTaxRateId ?? undefined,
        },
      ],
    });
  }

  private async getForMutation(request: RequestWithAccess, id: string): Promise<Alert> {
    const alert = await this.alertRepository.findById(id);
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    assertOutletAccess(request, alert.outletId, [...ALERT_MUTATE_ROLES] as Role[]);
    return alert;
  }

}

/**
 * Built from the event's own fields — no Item lookup.
 *
 * That is deliberate and load-bearing rather than a micro-optimisation:
 * reading the Item row here deadlocked against the Serializable
 * `item.update()` of a *concurrent* stock movement on the same item, which
 * turned FR-02's clean "insufficient stock" 400 into a 500. See the note on
 * ItemStockChangedEvent.itemName.
 */
function describeStock(
  input: { itemName: string; currentStock: string; minStock: string },
  type: AlertType,
): string {
  return type === 'OUT_OF_STOCK'
    ? `${input.itemName} is out of stock (${input.currentStock} on hand).`
    : `${input.itemName} is at or below its minimum stock level — ${input.currentStock} on hand, minimum ${input.minStock}.`;
}

/** Spec: "a suggested quantity (maxStock - currentStock)". Clamped at zero
 * so an over-stocked item never suggests a negative order. */
export function suggestedOrderQuantity(maxStock: string, currentStock: string): string {
  const suggested = Number(maxStock) - Number(currentStock);
  return (suggested > 0 ? suggested : 0).toFixed(3);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
