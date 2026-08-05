// FR-07 names this exact event ("publish an event (item.stock.changed) to
// a queue ... consumed by an AlertsProcessor"). FR-07 doesn't exist yet
// (build order step 12) — this is emitted now with no listener, so FR-07
// only needs to add an @OnEvent(ITEM_STOCK_CHANGED_EVENT) handler later,
// zero changes here.
export const ITEM_STOCK_CHANGED_EVENT = 'item.stock.changed';

export interface ItemStockChangedEvent {
  itemId: string;
  outletId: string;
  /**
   * Carried on the event rather than looked up by the consumer, and that is
   * load-bearing: FR-07's listener only needs the Item row for its name, and
   * reading it deadlocked against the Serializable `item.update()` of a
   * *concurrent* stock movement on the same item — turning a clean
   * "insufficient stock" 400 into a 500. The emitter already has the row in
   * hand, so passing the name costs nothing and removes the contention.
   */
  itemName: string;
  currentStock: string;
  minStock: string;
}
