import { estimateExpiry, evaluateStockLevel, isWithinExpiryWindow } from './evaluate-stock-level';

describe('evaluateStockLevel', () => {
  it('says nothing when stock is comfortably above the minimum', () => {
    expect(evaluateStockLevel('50.000', '10.000')).toBeNull();
  });

  it('AC: raises LOW_STOCK at the minimum, not only below it', () => {
    // minStock is the reorder level, so reaching it is the moment to say so.
    expect(evaluateStockLevel('10.000', '10.000')).toBe('LOW_STOCK');
    expect(evaluateStockLevel('9.999', '10.000')).toBe('LOW_STOCK');
  });

  it('raises OUT_OF_STOCK at zero, in preference to LOW_STOCK', () => {
    // One alert, not two — zero is both "below minimum" and "out", and the
    // more severe reading is the useful one.
    expect(evaluateStockLevel('0.000', '10.000')).toBe('OUT_OF_STOCK');
  });

  it('treats a negative balance as out of stock, not as healthy', () => {
    // Reachable: FR-06 records an oversell rather than refusing the sale.
    expect(evaluateStockLevel('-2.500', '10.000')).toBe('OUT_OF_STOCK');
  });

  it('raises OUT_OF_STOCK at zero even when the minimum is zero', () => {
    expect(evaluateStockLevel('0.000', '0.000')).toBe('OUT_OF_STOCK');
  });

  it('says nothing for an item with a zero minimum that still has stock', () => {
    // A minStock of 0 means "never reorder on level" — it must not make
    // every positive balance a low-stock alert.
    expect(evaluateStockLevel('0.001', '0.000')).toBeNull();
  });

  it('stays silent on unparseable numbers rather than alerting on everything', () => {
    expect(evaluateStockLevel('not-a-number', '10.000')).toBeNull();
    expect(evaluateStockLevel('10.000', 'nonsense')).toBeNull();
  });
});

describe('estimateExpiry', () => {
  const received = new Date('2026-07-20T00:00:00.000Z');

  it('adds the shelf life to the last receipt date', () => {
    expect(estimateExpiry(received, 5)?.toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });

  it('rolls over month boundaries correctly', () => {
    expect(estimateExpiry(received, 20)?.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('returns null when the item has no shelf life recorded', () => {
    expect(estimateExpiry(received, null)).toBeNull();
  });

  it('returns null when nothing has ever been received', () => {
    // Without a receipt there is no date to count from — guessing from
    // createdAt would invent an expiry the stock may not have.
    expect(estimateExpiry(null, 5)).toBeNull();
  });

  it('ignores a zero or negative shelf life rather than expiring on arrival', () => {
    expect(estimateExpiry(received, 0)).toBeNull();
    expect(estimateExpiry(received, -3)).toBeNull();
  });
});

describe('isWithinExpiryWindow', () => {
  const now = new Date('2026-07-20T00:00:00.000Z');

  it('is false for stock expiring beyond the lead window', () => {
    expect(isWithinExpiryWindow(new Date('2026-07-25T00:00:00.000Z'), now, 3)).toBe(false);
  });

  it('is true exactly at the edge of the window', () => {
    expect(isWithinExpiryWindow(new Date('2026-07-23T00:00:00.000Z'), now, 3)).toBe(true);
  });

  it('is true inside the window', () => {
    expect(isWithinExpiryWindow(new Date('2026-07-21T00:00:00.000Z'), now, 3)).toBe(true);
  });

  it('AC: is true for stock that has already expired — the most urgent case', () => {
    // "Days remaining" is negative here; treating that as out of range would
    // drop exactly the items that most need flagging.
    expect(isWithinExpiryWindow(new Date('2026-07-10T00:00:00.000Z'), now, 3)).toBe(true);
  });
});
