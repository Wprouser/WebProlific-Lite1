import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import { AlertsService } from '../src/alerts/services/alerts.service';

/**
 * Exercises FR-07's acceptance criteria end-to-end against a real (test) SQL
 * Server database. Requires: docker compose up -d && npm run
 * prisma:migrate:test && npm run test:e2e (targets webprolific_test via
 * test/env-setup.ts, never the dev database).
 */
describe('Low-Stock & Expiry Alerts (FR-07) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let alertsService: AlertsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    tokenService = app.get(TokenService);
    alertsService = app.get(AlertsService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.alert.deleteMany();
    await prisma.gRNLine.deleteMany();
    await prisma.gRN.deleteMany();
    await prisma.pOLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.unitOfMeasure.deleteMany();
    await prisma.category.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.outlet.deleteMany();
    await prisma.property.deleteMany();
    await prisma.chain.deleteMany();
    await prisma.user.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  let seq = 0;

  async function actor(email: string, outletId: string, role: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    await prisma.userAccess.create({
      data: { userId: user.id, scopeType: 'OUTLET', scopeId: outletId, role },
    });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  async function outletFixture() {
    const chain = await prisma.chain.create({ data: { name: `Chain ${++seq}` } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' },
    });
    const category = await prisma.category.create({ data: { name: 'Dry Goods', outletId: outlet.id } });
    const unit = await prisma.unitOfMeasure.create({
      data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id },
    });
    const supplier = await prisma.supplier.create({
      data: { outletId: outlet.id, name: 'Al-Fahad Trading', preferredCurrency: 'SAR' },
    });
    return { outlet, category, unit, supplier };
  }

  async function stockedItem(
    ctx: Awaited<ReturnType<typeof outletFixture>>,
    overrides: Record<string, unknown> = {},
  ) {
    return prisma.item.create({
      data: {
        outletId: ctx.outlet.id,
        categoryId: ctx.category.id,
        unitId: ctx.unit.id,
        name: 'Basmati Rice',
        sku: `SKU-${String(++seq).padStart(4, '0')}`,
        minStock: '10.000',
        maxStock: '100.000',
        currentStock: '50.000',
        costPrice: '8.50',
        defaultSupplierId: ctx.supplier.id,
        ...overrides,
      },
    });
  }

  /** Moves stock through the real FR-02 endpoint, which is what emits
   * `item.stock.changed` — the whole point of the listener under test. */
  async function moveStock(token: string, itemId: string, type: string, quantity: string) {
    return api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, type, quantity, forceOverride: true })
      .expect(201);
  }

  /** The listener runs off a fire-and-forget event, so it is not finished
   * when the HTTP response returns — that decoupling is the point. Polls
   * briefly rather than sleeping a fixed time. */
  async function eventually<T>(check: () => Promise<T | null>, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await check();
      if (result) return result;
      if (Date.now() > deadline) throw new Error('Condition not met within timeout');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // ---------------------------------------------------------------- AC 2

  it('AC: alert creation is decoupled — the stock-transaction response does not wait for it', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');

    // The alert is created by a listener on a fire-and-forget event, so it
    // arrives *after* the response rather than as part of it.
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));
    expect(alert).toMatchObject({ type: 'LOW_STOCK', status: 'OPEN', outletId: ctx.outlet.id });
    expect(alert.message).toContain('Basmati Rice');
  });

  it('raises OUT_OF_STOCK when a movement empties the shelf', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '50.000');

    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));
    expect(alert.type).toBe('OUT_OF_STOCK');
  });

  it('raises nothing while stock stays above the minimum', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '5.000');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.alert.count()).toBe(0);
  });

  // ---------------------------------------------------------------- AC 1

  it('AC: no duplicate OPEN alert for the same item+type within the cooldown window', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    // Two more movements that each leave it below minimum.
    await moveStock(token, item.id, 'USAGE_OUT', '1.000');
    await moveStock(token, item.id, 'USAGE_OUT', '1.000');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(await prisma.alert.count({ where: { itemId: item.id, type: 'LOW_STOCK' } })).toBe(1);
  });

  it('an acknowledged alert still suppresses a duplicate — acknowledging is not fixing', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await moveStock(token, item.id, 'USAGE_OUT', '1.000');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.alert.count({ where: { itemId: item.id } })).toBe(1);
  });

  it('raises again once the cooldown window has passed', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    const first = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    // Backdate past the 24h default rather than waiting for it.
    await prisma.alert.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    await moveStock(token, item.id, 'USAGE_OUT', '1.000');
    await eventually(async () => {
      const count = await prisma.alert.count({ where: { itemId: item.id } });
      return count === 2 ? count : null;
    });
  });

  it('resolves the alert by itself once stock is replenished', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id, status: 'OPEN' } }));

    await moveStock(token, item.id, 'PURCHASE_IN', '60.000');

    const resolved = await eventually(() =>
      prisma.alert.findFirst({ where: { itemId: item.id, status: 'RESOLVED' } }),
    );
    expect(resolved.resolvedAt).not.toBeNull();
  });

  // ------------------------------------------------------------- expiry scan

  it('raises an expiry warning for stock nearing the end of its shelf life', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx, { name: 'Fresh Cream', shelfLifeDays: 5, currentStock: '0.000' });

    // A real receipt is what the estimate counts from.
    await moveStock(token, item.id, 'PURCHASE_IN', '4.000');
    await prisma.stockTransaction.updateMany({
      where: { itemId: item.id, type: 'PURCHASE_IN' },
      data: { createdAt: new Date('2026-07-20T00:00:00.000Z') },
    });

    // Received 20 Jul + 5 days = 25 Jul; scanning on 23 Jul is inside the
    // 3-day default lead window.
    const raised = await alertsService.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'));

    expect(raised).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'EXPIRY_WARNING' } });
    expect(alert.message).toContain('Fresh Cream');
    expect(alert.message).toContain('2026-07-25');
  });

  it('skips items with no shelf life, and items with nothing on hand', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    // No shelf life at all.
    const plain = await stockedItem(ctx, { name: 'Rice' });
    // Shelf life, but empty — nothing there to spoil.
    await stockedItem(ctx, { name: 'Empty Cream', shelfLifeDays: 2, currentStock: '0.000' });
    await moveStock(token, plain.id, 'PURCHASE_IN', '1.000');

    expect(await alertsService.scanForExpiringStock(new Date('2026-07-23T00:00:00.000Z'))).toBe(0);
  });

  // ---------------------------------------------------------------- AC 3

  it('AC: create-po-draft produces a DRAFT PO with the item and maxStock - currentStock', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    const po = await api()
      .post(`/api/v1/alerts/${alert.id}/create-po-draft`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(po.body).toMatchObject({ status: 'DRAFT', outletId: ctx.outlet.id, supplierId: ctx.supplier.id });
    // 100 max - 5 remaining
    expect(po.body.lines).toHaveLength(1);
    expect(po.body.lines[0]).toMatchObject({ itemId: item.id, orderedQty: '95.000' });
  });

  it('refuses the PO shortcut when the item has no default supplier, naming it', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx, { name: 'Orphan Item', defaultSupplierId: null });

    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    const rejected = await api()
      .post(`/api/v1/alerts/${alert.id}/create-po-draft`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(rejected.body.message).toContain('Orphan Item');
  });

  // ------------------------------------------------------------ list + scope

  it('lists alerts scoped to the caller, filterable by status and type', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);
    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    const all = await api().get('/api/v1/alerts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0].itemName).toBe('Basmati Rice');

    const wrongType = await api()
      .get('/api/v1/alerts?type=EXPIRY_WARNING')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wrongType.body).toEqual([]);
  });

  it('does not leak another outlet\'s alerts', async () => {
    const mine = await outletFixture();
    const theirs = await outletFixture();
    const { token } = await actor('mgr@example.com', mine.outlet.id, 'OUTLET_MANAGER');
    const other = await actor('other@example.com', theirs.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(theirs);

    await moveStock(other.token, item.id, 'USAGE_OUT', '45.000');
    await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    const list = await api().get('/api/v1/alerts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body).toEqual([]);
  });

  it('refuses to acknowledge an alert in an outlet the caller cannot see', async () => {
    const mine = await outletFixture();
    const theirs = await outletFixture();
    const { token } = await actor('outsider@example.com', mine.outlet.id, 'OUTLET_MANAGER');
    const other = await actor('owner@example.com', theirs.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(theirs);

    await moveStock(other.token, item.id, 'USAGE_OUT', '45.000');
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  // -------------------------------------------------------------- the bar

  it('summarizes counts across FR-07 alerts and FR-04 states, for the Global Alert Bar', async () => {
    const ctx = await outletFixture();
    const { token, userId } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);
    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    // A PO awaiting approval and a variance-flagged GRN — the two badges
    // that were never FR-07's, and never had an endpoint.
    await prisma.purchaseOrder.create({
      data: {
        outletId: ctx.outlet.id,
        supplierId: ctx.supplier.id,
        createdById: userId,
        status: 'PENDING_APPROVAL',
        currencyCode: 'SAR',
        exchangeRateToBase: '1',
        isTaxInclusive: false,
        discountAmount: '0.00',
        otherChargesAmount: '0.00',
        subtotal: '10.00',
        taxAmount: '0.00',
        totalValue: '10.00',
      },
    });
    await prisma.gRN.create({
      data: {
        outletId: ctx.outlet.id,
        supplierId: ctx.supplier.id,
        receivedById: userId,
        currencyCode: 'SAR',
        exchangeRateToBase: '1',
        isTaxInclusive: false,
        discountAmount: '0.00',
        otherChargesAmount: '0.00',
        subtotal: '10.00',
        taxAmount: '0.00',
        totalValue: '10.00',
        varianceFlagged: true,
      },
    });

    const summary = await api()
      .get('/api/v1/alerts/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(summary.body).toEqual({
      lowStock: 1,
      expiry: 0,
      unacknowledged: 1,
      poApprovals: 1,
      grnVariance: 1,
    });
  });

  it('stops counting an alert as unacknowledged once someone acknowledges it', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const item = await stockedItem(ctx);
    await moveStock(token, item.id, 'USAGE_OUT', '45.000');
    const alert = await eventually(() => prisma.alert.findFirst({ where: { itemId: item.id } }));

    await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const summary = await api()
      .get('/api/v1/alerts/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Still a live low-stock problem, but no longer unseen.
    expect(summary.body).toMatchObject({ lowStock: 1, unacknowledged: 0 });
  });
});
