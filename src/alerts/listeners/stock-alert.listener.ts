import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ITEM_STOCK_CHANGED_EVENT,
  ItemStockChangedEvent,
} from '../../stock-transactions/events/stock-changed.event';
import { AlertsService } from '../services/alerts.service';

/**
 * FR-07's hook into FR-02, and the reason `item.stock.changed` was emitted
 * with no listener back then.
 *
 * The spec calls for a queue (BullMQ/Redis) to keep alert generation off the
 * stock-transaction request path. The acceptance criterion is specifically
 * that decoupling, and `StockTransactionsService` emits this event with
 * `.emit()` — fire-and-forget, unlike the `.emitAsync()` FR-18 deliberately
 * awaits — so the handler already runs outside the request's await path
 * without any broker. What this trades away versus a real queue: no retry,
 * no persistence if the process dies mid-handler, and no cross-instance
 * coordination. Accepted deliberately at current scale; swapping in a queue
 * later means changing this file and nothing else.
 */
@Injectable()
export class StockAlertListener {
  private readonly logger = new Logger(StockAlertListener.name);

  constructor(private readonly alertsService: AlertsService) {}

  @OnEvent(ITEM_STOCK_CHANGED_EVENT)
  async handleStockChanged(event: ItemStockChangedEvent): Promise<void> {
    try {
      await this.alertsService.evaluateItemStock({
        itemId: event.itemId,
        outletId: event.outletId,
        itemName: event.itemName,
        currentStock: event.currentStock,
        minStock: event.minStock,
      });
    } catch (error) {
      // Nothing is awaiting this, so an unhandled rejection here would be an
      // unexplained crash rather than a failed request. A missed alert must
      // not take the process down — the stock movement itself already
      // committed.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to evaluate alerts for item ${event.itemId}: ${message}`);
    }
  }
}
