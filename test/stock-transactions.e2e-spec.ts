import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-02's acceptance criteria end-to-end against a real (test)
 * SQL Server database, plus its FR-18 (ActivityLog/TransactionLog) wiring.
 * Requires: docker compose up -d && npm run prisma:migrate:test && npm run
 * test:e2e (targets webprolific_test via test/env-setup.ts, never the dev
 * database).
 */
describe('Stock Transactions (FR-02) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.transactionLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.category.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.outlet.deleteMany();
    await prisma.property.deleteMany();
    await prisma.chain.deleteMany();
    await prisma.user.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  async function actor(email: string, outletId: string, role: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    await prisma.userAccess.create({ data: { userId: user.id, scopeType: 'OUTLET', scopeId: outletId, role } });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  // sku is globally unique across the whole table (see FR-01), and a test
  // may call this helper more than once (e.g. to set up a second, unrelated
  // outlet) — a fixed default sku would collide with itself.
  let skuCounter = 0;

  async function outletWithItem(overrides: Record<string, unknown> = {}) {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({ data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' } });
    const outlet = await prisma.outlet.create({ data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' } });
    const cat = await prisma.category.create({ data: { name: 'Dry Goods', outletId: outlet.id } });
    const unit = await prisma.unitOfMeasure.create({ data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id } });
    const item = await prisma.item.create({
      data: {
        outletId: outlet.id,
        categoryId: cat.id,
        unitId: unit.id,
        name: 'Basmati Rice',
        sku: `RICE-BAS-${String(++skuCounter).padStart(3, '0')}`,
        minStock: '10',
        maxStock: '1000',
        costPrice: '85.50',
        currentStock: '0',
        ...overrides,
      },
    });
    return { outlet, item };
  }

  function txPayload(overrides: Record<string, unknown> = {}) {
    return { type: 'PURCHASE_IN', quantity: '10', ...overrides };
  }

  // ---------------------------------------------------------------------
  // Validation ACs
  // ---------------------------------------------------------------------

  it('AC: WASTAGE_OUT without reasonCode returns 400', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('owner1@example.com', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'WASTAGE_OUT', quantity: '2' }))
      .expect(400);
  });

  it('WASTAGE_OUT with a reasonCode succeeds and reduces currentStock', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('owner2@example.com', outlet.id, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'WASTAGE_OUT', quantity: '2', reasonCode: 'EXPIRED' }))
      .expect(201);
    expect(res.body.balanceAfter).toBe('18.000');

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.currentStock.toFixed(3)).toBe('18.000');
  });

  it('rejects a non-positive quantity', async () => {
    const { outlet, item } = await outletWithItem();
    const { token } = await actor('owner3@example.com', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '0' }))
      .expect(400);
  });

  it('rejects a stock-out that would take the balance negative, without forceOverride', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '5' });
    const { token } = await actor('owner4@example.com', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '10' }))
      .expect(400);

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.currentStock.toFixed(3)).toBe('5.000'); // untouched
  });

  it('AC: transactions are never editable or deletable via API', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('owner5@example.com', outlet.id, 'OUTLET_MANAGER');
    const created = await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '2' }))
      .expect(201);

    await api()
      .patch(`/api/v1/stock-transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: '999' })
      .expect(404); // no route exists
    await api()
      .delete(`/api/v1/stock-transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404); // no route exists
  });

  // ---------------------------------------------------------------------
  // Role restrictions (FR-11 permission matrix)
  // ---------------------------------------------------------------------

  it('CHEF may record USAGE_OUT but not PURCHASE_IN', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('chef1@example.com', outlet.id, 'CHEF');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '5' }))
      .expect(403);

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '5' }))
      .expect(201);
  });

  it('STORE_STAFF may record any transaction type', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('staff1@example.com', outlet.id, 'STORE_STAFF');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '5' }))
      .expect(201);
  });

  it('a caller with no access to the item\'s outlet gets 403', async () => {
    const { item } = await outletWithItem({ currentStock: '20' });
    const { outlet: otherOutlet } = await outletWithItem();
    const { token } = await actor('outsider@example.com', otherOutlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '5' }))
      .expect(403);
  });

  // ---------------------------------------------------------------------
  // forceOverride
  // ---------------------------------------------------------------------

  it('AC: forceOverride from an OUTLET_MANAGER allows a negative balance and logs AuditLog severity HIGH', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '5' });
    const { token } = await actor('mgr1@example.com', outlet.id, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '10', forceOverride: true }))
      .expect(201);
    expect(res.body.balanceAfter).toBe('-5.000');

    const auditRows = await prisma.auditLog.findMany({ where: { entityId: res.body.id } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.severity).toBe('HIGH');
  });

  it('forceOverride from STORE_STAFF is not honored', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '5' });
    const { token } = await actor('staff2@example.com', outlet.id, 'STORE_STAFF');

    await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '10', forceOverride: true }))
      .expect(400);
  });

  // ---------------------------------------------------------------------
  // Concurrency (the critical FR-02 AC)
  // ---------------------------------------------------------------------

  it('AC: two concurrent stock-out requests for the same item never result in an incorrect negative balance', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '10' });
    const { token } = await actor('mgr2@example.com', outlet.id, 'OUTLET_MANAGER');

    const [first, second] = await Promise.all([
      api()
        .post('/api/v1/stock-transactions')
        .set('Authorization', `Bearer ${token}`)
        .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '6' })),
      api()
        .post('/api/v1/stock-transactions')
        .set('Authorization', `Bearer ${token}`)
        .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '6' })),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one of the two 6-unit deductions against a starting balance
    // of 10 can succeed — the other must be rejected, not silently produce
    // a negative balance.
    expect(statuses).toEqual([201, 400]);

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(updated.currentStock.toFixed(3))).toBeGreaterThanOrEqual(0);
    expect(updated.currentStock.toFixed(3)).toBe('4.000');
  });

  // ---------------------------------------------------------------------
  // Data integrity
  // ---------------------------------------------------------------------

  it('AC: balanceAfter on each row matches a recomputed running sum from full history', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '0' });
    const { token } = await actor('mgr3@example.com', outlet.id, 'OUTLET_MANAGER');

    await api().post('/api/v1/stock-transactions').set('Authorization', `Bearer ${token}`).send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '20' })).expect(201);
    await api().post('/api/v1/stock-transactions').set('Authorization', `Bearer ${token}`).send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '5' })).expect(201);
    await api().post('/api/v1/stock-transactions').set('Authorization', `Bearer ${token}`).send(txPayload({ itemId: item.id, type: 'WASTAGE_OUT', quantity: '2', reasonCode: 'DAMAGED' })).expect(201);

    const rows = await prisma.stockTransaction.findMany({ where: { itemId: item.id }, orderBy: { createdAt: 'asc' } });
    let running = 0;
    for (const row of rows) {
      const direction = row.type.endsWith('_IN') ? 1 : -1;
      running += direction * Number(row.quantity);
      expect(Number(row.balanceAfter.toFixed(3))).toBeCloseTo(running, 3);
    }
    expect(running).toBe(13);
  });

  // ---------------------------------------------------------------------
  // FR-18 wiring
  // ---------------------------------------------------------------------

  it('AC: creating a stock transaction produces one ActivityLog (category STOCK) and one TransactionLog (TRANSACTIONAL, CREATE) row', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('mgr4@example.com', outlet.id, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/stock-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '3' }))
      .expect(201);

    const activityRows = await prisma.activityLog.findMany({ where: { entityId: res.body.id } });
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]!.category).toBe('STOCK');
    expect(activityRows[0]!.action).toBe('CREATE_STOCK_TRANSACTION');

    const txnRows = await prisma.transactionLog.findMany({ where: { entityId: res.body.id } });
    expect(txnRows).toHaveLength(1);
    expect(txnRows[0]!.operation).toBe('CREATE');
    expect(txnRows[0]!.entityCategory).toBe('TRANSACTIONAL');
    expect(txnRows[0]!.outletId).toBe(outlet.id);
  });

  // ---------------------------------------------------------------------
  // List/filter
  // ---------------------------------------------------------------------

  it('GET /stock-transactions filters by itemId and type', async () => {
    const { outlet, item } = await outletWithItem({ currentStock: '20' });
    const { token } = await actor('mgr5@example.com', outlet.id, 'OUTLET_MANAGER');
    await api().post('/api/v1/stock-transactions').set('Authorization', `Bearer ${token}`).send(txPayload({ itemId: item.id, type: 'PURCHASE_IN', quantity: '5' })).expect(201);
    await api().post('/api/v1/stock-transactions').set('Authorization', `Bearer ${token}`).send(txPayload({ itemId: item.id, type: 'USAGE_OUT', quantity: '3' })).expect(201);

    const res = await api()
      .get(`/api/v1/stock-transactions?itemId=${item.id}&type=USAGE_OUT`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('USAGE_OUT');
  });
});
