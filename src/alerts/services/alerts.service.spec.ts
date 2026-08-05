import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertsService, suggestedOrderQuantity } from './alerts.service';
import { AlertRepository, ExpiryCandidate } from '../repositories/alert.repository';
import { Alert } from '../domain/alert.entity';
import { ItemRepository } from '../../items/repositories/item.repository';
import { Item } from '../../items/domain/item.entity';
import { PurchaseOrdersService } from '../../purchase-orders/services/purchase-orders.service';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { Role } from '../../tenancy/constants/enums';

const OUTLET = 'o1';

function requestFor(role: Role | null = 'OUTLET_MANAGER'): RequestWithAccess {
  return {
    user: { id: 'u1' },
    effectiveAccess: {
      effectiveOutletIds: [OUTLET],
      roleForOutlet: (outletId: string) => (outletId === OUTLET ? role ?? undefined : undefined),
    },
  } as unknown as RequestWithAccess;
}

function fixtureAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    outletId: OUTLET,
    itemId: 'i1',
    type: 'LOW_STOCK',
    status: 'OPEN',
    message: 'Rice is low',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function fixtureItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    outletId: OUTLET,
    name: 'Basmati Rice',
    unitId: 'kg',
    minStock: '10.000',
    maxStock: '100.000',
    currentStock: '5.000',
    costPrice: '8.50',
    defaultSupplierId: 'sup-1',
    defaultTaxRateId: null,
    ...overrides,
  } as Item;
}

describe('AlertsService', () => {
  function build(options: { existingLive?: Alert | null; item?: Item | null } = {}) {
    const alertRepository: Partial<AlertRepository> = {
      create: jest.fn().mockImplementation(async (input) => fixtureAlert(input)),
      findById: jest.fn().mockResolvedValue(fixtureAlert()),
      findLiveAlert: jest.fn().mockResolvedValue(options.existingLive ?? null),
      updateStatus: jest
        .fn()
        .mockImplementation(async (id: string, status: Alert['status']) => fixtureAlert({ id, status })),
      resolveLiveStockAlerts: jest.fn().mockResolvedValue(0),
      findExpiryCandidates: jest.fn().mockResolvedValue([]),
      summarize: jest.fn().mockResolvedValue({
        lowStock: 0,
        expiry: 0,
        unacknowledged: 0,
        poApprovals: 0,
        grnVariance: 0,
      }),
      findScoped: jest.fn().mockResolvedValue([]),
    };
    const itemRepository: Partial<ItemRepository> = {
      findById: jest.fn().mockResolvedValue(options.item === undefined ? fixtureItem() : options.item),
    };
    const purchaseOrdersService = { create: jest.fn().mockResolvedValue({ id: 'po-1', status: 'DRAFT' }) } as unknown as PurchaseOrdersService;
    const activityBus = { record: jest.fn() } as unknown as ActivityBus;
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;

    const service = new AlertsService(
      alertRepository as AlertRepository,
      itemRepository as ItemRepository,
      purchaseOrdersService,
      activityBus,
      config,
    );
    return { service, alertRepository, itemRepository, purchaseOrdersService, activityBus, config };
  }

  // The name rides on the event rather than being looked up — see the note
  // on ItemStockChangedEvent.itemName.
  const lowStockInput = {
    itemId: 'i1',
    outletId: OUTLET,
    itemName: 'Basmati Rice',
    currentStock: '5.000',
    minStock: '10.000',
  };

  // ------------------------------------------------------------ raise + dedup

  it('raises a LOW_STOCK alert naming the item and both numbers', async () => {
    const { service, alertRepository } = build();
    await service.evaluateItemStock(lowStockInput);

    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ outletId: OUTLET, itemId: 'i1', type: 'LOW_STOCK' }),
    );
    const [{ message }] = (alertRepository.create as jest.Mock).mock.calls[0];
    expect(message).toContain('Basmati Rice');
    expect(message).toContain('5.000');
    expect(message).toContain('10.000');
  });

  it('raises OUT_OF_STOCK rather than LOW_STOCK at zero', async () => {
    const { service, alertRepository } = build();
    await service.evaluateItemStock({ ...lowStockInput, currentStock: '0.000' });
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OUT_OF_STOCK' }),
    );
  });

  it('AC: does not raise a duplicate while an equivalent alert is still live', async () => {
    const { service, alertRepository } = build({ existingLive: fixtureAlert() });
    const result = await service.evaluateItemStock(lowStockInput);

    expect(result).toBeNull();
    expect(alertRepository.create).not.toHaveBeenCalled();
  });

  it('AC: looks for duplicates only within the cooldown window', async () => {
    const { service, alertRepository } = build();
    const before = Date.now();
    await service.evaluateItemStock(lowStockInput);

    const [, , since] = (alertRepository.findLiveAlert as jest.Mock).mock.calls[0];
    const hoursBack = (before - (since as Date).getTime()) / (60 * 60 * 1000);
    // Default 24h, per the spec.
    expect(hoursBack).toBeGreaterThan(23.9);
    expect(hoursBack).toBeLessThan(24.1);
  });

  it('honours a configured cooldown override', async () => {
    const { service, alertRepository, config } = build();
    (config.get as jest.Mock).mockImplementation((key: string) =>
      key === 'ALERT_COOLDOWN_HOURS' ? '2' : undefined,
    );
    const before = Date.now();
    await service.evaluateItemStock(lowStockInput);

    const [, , since] = (alertRepository.findLiveAlert as jest.Mock).mock.calls[0];
    const hoursBack = (before - (since as Date).getTime()) / (60 * 60 * 1000);
    expect(hoursBack).toBeLessThan(2.1);
  });

  it('records every raised alert in the FR-18 feed, with no actor', async () => {
    const { service, activityBus } = build();
    await service.evaluateItemStock(lowStockInput);

    expect(activityBus.record).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ALERT', action: 'ALERT_LOW_STOCK', outletId: OUTLET }),
    );
    const [event] = (activityBus.record as jest.Mock).mock.calls[0];
    expect(event.userId).toBeUndefined();
  });

  // -------------------------------------------------------------- auto-resolve

  it('resolves live alerts when stock recovers, instead of leaving them open forever', async () => {
    const { service, alertRepository } = build();
    (alertRepository.resolveLiveStockAlerts as jest.Mock).mockResolvedValue(2);

    const result = await service.evaluateItemStock({ ...lowStockInput, currentStock: '50.000' });

    expect(result).toBeNull();
    expect(alertRepository.resolveLiveStockAlerts).toHaveBeenCalledWith('i1', expect.any(Date));
    expect(alertRepository.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------- expiry scan

  function candidate(overrides: Partial<ExpiryCandidate> = {}): ExpiryCandidate {
    return {
      itemId: 'i1',
      outletId: OUTLET,
      itemName: 'Fresh Cream',
      shelfLifeDays: 5,
      currentStock: '4.000',
      lastPurchaseInAt: new Date('2026-07-20T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('raises an expiry warning inside the lead window', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([candidate()]);

    // Received 20 Jul + 5 days = expires 25 Jul; scanning on 23 Jul is 2 days out.
    const raised = await service.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'));

    expect(raised).toBe(1);
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXPIRY_WARNING', itemId: 'i1' }),
    );
    const [{ message }] = (alertRepository.create as jest.Mock).mock.calls[0];
    expect(message).toContain('Fresh Cream');
    expect(message).toContain('2026-07-25');
  });

  it('says "has expired" rather than "will expire" once the date has passed', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([candidate()]);

    await service.scanForExpiringStock(new Date('2026-07-28T00:00:00.000Z'));
    const [{ message }] = (alertRepository.create as jest.Mock).mock.calls[0];
    expect(message).toMatch(/have expired/);
  });

  it('leaves stock outside the lead window alone', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([candidate()]);

    const raised = await service.scanForExpiringStock(new Date('2026-07-20T00:00:00.000Z'));
    expect(raised).toBe(0);
    expect(alertRepository.create).not.toHaveBeenCalled();
  });

  it('skips a candidate that has never been received', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([
      candidate({ lastPurchaseInAt: null }),
    ]);

    expect(await service.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'))).toBe(0);
  });

  it('counts only newly raised alerts, not ones suppressed by dedup', async () => {
    // A nightly scan re-sees the same expiring item every night; the count
    // it logs should be "new tonight", not "still expiring".
    const { service, alertRepository } = build({
      existingLive: fixtureAlert({ type: 'EXPIRY_WARNING' }),
    });
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([candidate()]);

    expect(await service.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'))).toBe(0);
    expect(alertRepository.create).not.toHaveBeenCalled();
  });

  it('keeps scanning after one candidate is skipped', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findExpiryCandidates as jest.Mock).mockResolvedValue([
      candidate({ itemId: 'never-received', lastPurchaseInAt: null }),
      candidate({ itemId: 'expiring-soon' }),
    ]);

    expect(await service.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'))).toBe(1);
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'expiring-soon' }),
    );
  });

  // --------------------------------------------------------------- mutations

  it('acknowledging stamps a time and moves the status', async () => {
    const { service, alertRepository } = build();
    await service.acknowledge(requestFor(), 'a1');
    expect(alertRepository.updateStatus).toHaveBeenCalledWith(
      'a1',
      'ACKNOWLEDGED',
      expect.objectContaining({ acknowledgedAt: expect.any(Date) }),
    );
  });

  it('acknowledging an already-resolved alert does not re-open it', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findById as jest.Mock).mockResolvedValue(fixtureAlert({ status: 'RESOLVED' }));

    const result = await service.acknowledge(requestFor(), 'a1');
    expect(result.status).toBe('RESOLVED');
    expect(alertRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('resolving an already-resolved alert is a no-op rather than a second write', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findById as jest.Mock).mockResolvedValue(fixtureAlert({ status: 'RESOLVED' }));

    await service.resolve(requestFor(), 'a1');
    expect(alertRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses a caller with no access to the alert\'s outlet', async () => {
    const { service } = build();
    await expect(service.acknowledge(requestFor(null), 'a1')).rejects.toThrow(/No access to outlet/);
  });

  it('throws NotFound for a missing alert', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.resolve(requestFor(), 'missing')).rejects.toThrow(NotFoundException);
  });

  // ----------------------------------------------------------- create-po-draft

  it('AC: creates a DRAFT PO for the alerting item, quantity maxStock - currentStock', async () => {
    const { service, purchaseOrdersService } = build();
    await service.createPoDraft(requestFor(), 'a1');

    expect(purchaseOrdersService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outletId: OUTLET,
        supplierId: 'sup-1',
        lines: [expect.objectContaining({ itemId: 'i1', orderedQty: '95.000', expectedPrice: '8.50' })],
      }),
    );
  });

  it('refuses when the item has no default supplier, naming the item', async () => {
    const { service } = build({ item: fixtureItem({ defaultSupplierId: null }) });
    await expect(service.createPoDraft(requestFor(), 'a1')).rejects.toThrow(/Basmati Rice.*no default supplier/);
  });

  it('refuses when there is nothing to order', async () => {
    const { service } = build({ item: fixtureItem({ currentStock: '120.000', maxStock: '100.000' }) });
    await expect(service.createPoDraft(requestFor(), 'a1')).rejects.toThrow(/nothing to order/);
  });

  it('refuses for an alert that is not about a specific item', async () => {
    const { service, alertRepository } = build();
    (alertRepository.findById as jest.Mock).mockResolvedValue(fixtureAlert({ itemId: null }));
    await expect(service.createPoDraft(requestFor(), 'a1')).rejects.toThrow(BadRequestException);
  });
});

describe('suggestedOrderQuantity', () => {
  it('is the gap up to maximum stock', () => {
    expect(suggestedOrderQuantity('100.000', '5.000')).toBe('95.000');
  });

  it('never suggests a negative order for over-stocked items', () => {
    expect(suggestedOrderQuantity('100.000', '120.000')).toBe('0.000');
  });

  it('handles a negative balance from an oversell by ordering the full gap', () => {
    expect(suggestedOrderQuantity('100.000', '-5.000')).toBe('105.000');
  });
});
