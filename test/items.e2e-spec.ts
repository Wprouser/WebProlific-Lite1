import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { rmSync } from 'fs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import { UPLOADS_ROOT } from '../src/storage/repositories/local-disk-storage.repository';

/**
 * Exercises every FR-01 acceptance criterion end-to-end against a real
 * (test) SQL Server database, plus its FR-18 (ActivityLog/TransactionLog)
 * and FR-11 (costPrice field restriction) wiring. Requires:
 *   docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Item Master (FR-01) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;

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
  });

  afterAll(async () => {
    await app.close();
    // LocalDiskStorageRepository writes real files during the image-upload
    // tests below — clean the whole tree up rather than leaving test
    // artifacts in the working copy.
    rmSync(UPLOADS_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await prisma.transactionLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.itemImage.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.category.deleteMany();
    await prisma.unitOfMeasure.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.outlet.deleteMany();
    await prisma.property.deleteMany();
    await prisma.chain.deleteMany();
    await prisma.user.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  async function actor(email: string, scopeType: 'CHAIN' | 'PROPERTY' | 'OUTLET', scopeId: string, role: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    await prisma.userAccess.create({ data: { userId: user.id, scopeType, scopeId, role } });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  async function chainWithOutlet(outletName = 'Main Restaurant') {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: outletName, type: 'RESTAURANT' },
    });
    return { chain, property, outlet };
  }

  async function category(outletId: string, name = 'Dry Goods') {
    return prisma.category.create({ data: { name, outletId } });
  }

  async function unitOfMeasure(outletId: string, name = 'Kilogram', abbreviation = 'kg') {
    return prisma.unitOfMeasure.create({ data: { name, abbreviation, outletId } });
  }

  function itemPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Basmati Rice',
      sku: 'RICE-BAS-001',
      minStock: '10',
      maxStock: '100',
      costPrice: '85.50',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Validation ACs
  // ---------------------------------------------------------------------

  it('AC: cannot create two items with the same SKU', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner1@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id, barcode: undefined }))
      .expect(409);
  });

  it('AC: cannot set minStock >= maxStock', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner2@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id, minStock: '100', maxStock: '100' }))
      .expect(400);
  });

  it('AC: GET /items?belowMinStock=true returns only items where currentStock < minStock', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner3@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const low = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id, sku: 'LOW-1', minStock: '50' }))
      .expect(201);
    // currentStock defaults to 0 on create — 0 < 50, so this one already
    // qualifies as below min stock without needing FR-02 to exist.
    const normal = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id, sku: 'NORMAL-1', minStock: '0' }))
      .expect(201);

    const res = await api()
      .get('/api/v1/items?belowMinStock=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = res.body.map((i: { id: string }) => i.id);
    expect(ids).toContain(low.body.id);
    expect(ids).not.toContain(normal.body.id);
  });

  it('rejects create for STORE_STAFF (view-only per the FR-11 permission matrix)', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('staff1@example.com', 'OUTLET', outlet.id, 'STORE_STAFF');

    await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(403);
  });

  // ---------------------------------------------------------------------
  // FR-11: costPrice hidden from CHEF, including per-row for multi-outlet lists
  // ---------------------------------------------------------------------

  it('AC (FR-11): costPrice is present for OUTLET_MANAGER but stripped for CHEF, on both list and detail', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token: mgrToken } = await actor('mgr1@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
    const { token: chefToken } = await actor('chef1@example.com', 'OUTLET', outlet.id, 'CHEF');

    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    const chefDetail = await api()
      .get(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${chefToken}`)
      .expect(200);
    expect(chefDetail.body.costPrice).toBeUndefined();

    const mgrDetail = await api()
      .get(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .expect(200);
    expect(mgrDetail.body.costPrice).toBe('85.50');

    const chefList = await api().get('/api/v1/items').set('Authorization', `Bearer ${chefToken}`).expect(200);
    expect(chefList.body.every((i: Record<string, unknown>) => i.costPrice === undefined)).toBe(true);
  });

  it('AC (FR-11, per-row): a CHEF at outlet A but OUTLET_MANAGER at outlet B sees costPrice hidden only for outlet A\'s items', async () => {
    const { outlet: outletA } = await chainWithOutlet('Main Restaurant');
    const { outlet: outletB } = await chainWithOutlet('Pool Bar');
    const catA = await category(outletA.id);
    const catB = await category(outletB.id);
    const unitA = await unitOfMeasure(outletA.id);
    const unitB = await unitOfMeasure(outletB.id);
    const { token: creatorToken } = await actor('creator@example.com', 'OUTLET', outletA.id, 'OUTLET_MANAGER');
    await prisma.userAccess.create({
      data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'creator@example.com' } })).id, scopeType: 'OUTLET', scopeId: outletB.id, role: 'OUTLET_MANAGER' },
    });
    const itemA = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send(itemPayload({ outletId: outletA.id, categoryId: catA.id, unitId: unitA.id, sku: 'A-1' }))
      .expect(201);
    const itemB = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send(itemPayload({ outletId: outletB.id, categoryId: catB.id, unitId: unitB.id, sku: 'B-1' }))
      .expect(201);

    const mixedUser = await prisma.user.create({
      data: { email: 'mixed@example.com', passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    await prisma.userAccess.create({
      data: { userId: mixedUser.id, scopeType: 'OUTLET', scopeId: outletA.id, role: 'CHEF' },
    });
    await prisma.userAccess.create({
      data: { userId: mixedUser.id, scopeType: 'OUTLET', scopeId: outletB.id, role: 'OUTLET_MANAGER' },
    });
    const mixedToken = tokenService.signAccessToken(mixedUser.id);

    const res = await api().get('/api/v1/items').set('Authorization', `Bearer ${mixedToken}`).expect(200);
    const byId = Object.fromEntries(res.body.map((i: { id: string }) => [i.id, i]));
    expect(byId[itemA.body.id].costPrice).toBeUndefined();
    expect(byId[itemB.body.id].costPrice).toBe('85.50');
  });

  // ---------------------------------------------------------------------
  // FR-18 wiring
  // ---------------------------------------------------------------------

  it('AC: creating an item produces exactly one ActivityLog (category ITEM) and one TransactionLog (CREATE) row', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner4@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    const activityRows = await prisma.activityLog.findMany({ where: { entityId: res.body.id } });
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]!.category).toBe('ITEM');
    expect(activityRows[0]!.action).toBe('CREATE_ITEM');

    const txnRows = await prisma.transactionLog.findMany({ where: { entityId: res.body.id } });
    expect(txnRows).toHaveLength(1);
    expect(txnRows[0]!.operation).toBe('CREATE');
    expect(txnRows[0]!.entityCategory).toBe('MASTER_DATA');
    expect(txnRows[0]!.outletId).toBe(outlet.id);
  });

  it('AC: updating two fields on an item produces exactly two TransactionLog rows, one per field', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner5@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    await api()
      .patch(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Basmati Rice (Premium)', storageLocation: 'Dry Store A' })
      .expect(200);

    const rows = await prisma.transactionLog.findMany({
      where: { entityId: created.body.id, operation: 'UPDATE' },
    });
    expect(rows).toHaveLength(2);
    const byField = Object.fromEntries(rows.map((r) => [r.fieldName, r.newValue]));
    expect(byField.name).toBe('Basmati Rice (Premium)');
    expect(byField.storageLocation).toBe('Dry Store A');
  });

  it('AC: deactivating an item produces an ActivityLog + TransactionLog row and sets isActive false', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner6@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    const res = await api()
      .delete(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.isActive).toBe(false);

    const activityRows = await prisma.activityLog.findMany({
      where: { entityId: created.body.id, action: 'DEACTIVATE_ITEM' },
    });
    expect(activityRows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------

  it('creates a category and rejects a duplicate name within the same outlet', async () => {
    const { outlet } = await chainWithOutlet();
    const { token } = await actor('owner7@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/items/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dry Goods', outletId: outlet.id })
      .expect(201);

    await api()
      .post('/api/v1/items/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dry Goods', outletId: outlet.id })
      .expect(409);
  });

  it('GET /items/categories resolves correctly and is not swallowed by GET /items/:id', async () => {
    const { outlet } = await chainWithOutlet();
    const { token } = await actor('owner8@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
    await category(outlet.id, 'Produce');

    const res = await api()
      .get('/api/v1/items/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((c: { name: string }) => c.name === 'Produce')).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Opening stock (spec expansion)
  // ---------------------------------------------------------------------

  it('AC: creating an item with openingStock produces a real OPENING_BALANCE StockTransaction, not a raw currentStock write', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner9@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({
        outletId: outlet.id,
        categoryId: cat.id, unitId: unit.id,
        openingStock: { quantity: '25.000', ratePerUnit: '85.50' },
      }))
      .expect(201);

    expect(created.body.currentStock).toBe('25.000');

    const txns = await prisma.stockTransaction.findMany({ where: { itemId: created.body.id } });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.type).toBe('OPENING_BALANCE');
    expect(txns[0]!.quantity.toString()).toBe('25');
    expect(txns[0]!.balanceAfter.toString()).toBe('25');
  });

  it('creating an item without openingStock leaves currentStock at 0 with no StockTransaction row', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner10@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    expect(created.body.currentStock).toBe('0.000');
    const txns = await prisma.stockTransaction.findMany({ where: { itemId: created.body.id } });
    expect(txns).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // purchaseGLAccount / defaultTaxRateId (spec expansion)
  // ---------------------------------------------------------------------

  it('round-trips purchaseGLAccount and defaultTaxRateId through create and update', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner11@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({
        outletId: outlet.id,
        categoryId: cat.id, unitId: unit.id,
        purchaseGLAccount: 'Cost of Goods Sold',
        defaultTaxRateId: 'tax-rate-placeholder',
      }))
      .expect(201);
    expect(created.body.purchaseGLAccount).toBe('Cost of Goods Sold');
    expect(created.body.defaultTaxRateId).toBe('tax-rate-placeholder');

    const updated = await api()
      .patch(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ purchaseGLAccount: 'Inventory Asset' })
      .expect(200);
    expect(updated.body.purchaseGLAccount).toBe('Inventory Asset');
    expect(updated.body.defaultTaxRateId).toBe('tax-rate-placeholder');
  });

  // ---------------------------------------------------------------------
  // Clone (spec expansion)
  // ---------------------------------------------------------------------

  it('AC: cloning an item copies master data but never copies sku or current stock', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner12@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const source = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({
        outletId: outlet.id,
        categoryId: cat.id, unitId: unit.id,
        storageLocation: 'Dry Store',
        openingStock: { quantity: '10.000', ratePerUnit: '85.50' },
      }))
      .expect(201);

    const clone = await api()
      .post(`/api/v1/items/${source.body.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'RICE-BAS-002' })
      .expect(201);

    expect(clone.body.name).toBe('Basmati Rice (Copy)');
    expect(clone.body.sku).toBe('RICE-BAS-002');
    expect(clone.body.categoryId).toBe(cat.id);
    expect(clone.body.storageLocation).toBe('Dry Store');
    expect(clone.body.currentStock).toBe('0.000');

    const cloneTxns = await prisma.stockTransaction.findMany({ where: { itemId: clone.body.id } });
    expect(cloneTxns).toHaveLength(0);
  });

  it('rejects cloning into an already-used sku', async () => {
    const { outlet } = await chainWithOutlet();
    const cat = await category(outlet.id);
    const unit = await unitOfMeasure(outlet.id);
    const { token } = await actor('owner13@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

    const source = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
      .expect(201);

    await api()
      .post(`/api/v1/items/${source.body.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: source.body.sku })
      .expect(409);
  });

  // ---------------------------------------------------------------------
  // Item images (spec expansion)
  // ---------------------------------------------------------------------

  describe('item images', () => {
    // FileTypeValidator sniffs real magic numbers (via the `file-type`
    // package), not just the declared Content-Type — a minimal but genuine
    // 1x1 transparent PNG, so these tests exercise the real validation path
    // rather than something that only happens to pass because it's mocked.
    const PNG_1PX = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    async function createItem(token: string, outletId: string, categoryId: string, unitId: string) {
      const res = await api()
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${token}`)
        .send(itemPayload({ outletId, categoryId, unitId }))
        .expect(201);
      return res.body;
    }

    it('AC: the first image uploaded is automatically primary; a second is not', async () => {
      const { outlet } = await chainWithOutlet();
      const cat = await category(outlet.id);
      const unit = await unitOfMeasure(outlet.id);
      const { token } = await actor('owner14@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const item = await createItem(token, outlet.id, cat.id, unit.id);

      const first = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'one.png')
        .expect(201);
      expect(first.body.isPrimary).toBe(true);

      const second = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'two.png')
        .expect(201);
      expect(second.body.isPrimary).toBe(false);

      const list = await api()
        .get(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.map((i: { id: string }) => i.id).sort()).toEqual(
        [first.body.id, second.body.id].sort(),
      );
    });

    it('AC: deleting the primary image promotes the next-oldest remaining image to primary', async () => {
      const { outlet } = await chainWithOutlet();
      const cat = await category(outlet.id);
      const unit = await unitOfMeasure(outlet.id);
      const { token } = await actor('owner15@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const item = await createItem(token, outlet.id, cat.id, unit.id);

      const first = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'one.png')
        .expect(201);
      const second = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'two.png')
        .expect(201);

      await api()
        .delete(`/api/v1/items/${item.id}/images/${first.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const remaining = await prisma.itemImage.findUnique({ where: { id: second.body.id } });
      expect(remaining!.isPrimary).toBe(true);
    });

    it('PATCH .../primary swaps which image is primary', async () => {
      const { outlet } = await chainWithOutlet();
      const cat = await category(outlet.id);
      const unit = await unitOfMeasure(outlet.id);
      const { token } = await actor('owner16@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const item = await createItem(token, outlet.id, cat.id, unit.id);

      const first = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'one.png')
        .expect(201);
      const second = await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, 'two.png')
        .expect(201);

      await api()
        .patch(`/api/v1/items/${item.id}/images/${second.body.id}/primary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const rows = await prisma.itemImage.findMany({ where: { itemId: item.id } });
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.isPrimary]));
      expect(byId[first.body.id]).toBe(false);
      expect(byId[second.body.id]).toBe(true);
    });

    it('rejects a non-image file upload', async () => {
      const { outlet } = await chainWithOutlet();
      const cat = await category(outlet.id);
      const unit = await unitOfMeasure(outlet.id);
      const { token } = await actor('owner17@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const item = await createItem(token, outlet.id, cat.id, unit.id);

      await api()
        .post(`/api/v1/items/${item.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not an image'), 'notes.txt')
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------
  // Units of Measure (spec expansion — replaces the old hardcoded enum)
  // ---------------------------------------------------------------------

  describe('units of measure', () => {
    async function chainWithProperty() {
      const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
      const property = await prisma.property.create({
        data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
      });
      return { chain, property };
    }

    it('AC: a new outlet is seeded with the full 8-unit starter set (kg, g, L, mL, pc, box, dz, pack)', async () => {
      const { property } = await chainWithProperty();
      const { token } = await actor('unitowner1@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

      const outletRes = await api()
        .post(`/api/v1/properties/${property.id}/outlets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
        .expect(201);

      const units = await prisma.unitOfMeasure.findMany({ where: { outletId: outletRes.body.id } });
      expect(units.map((u) => u.abbreviation).sort()).toEqual(
        ['kg', 'g', 'L', 'mL', 'pc', 'box', 'dz', 'pack'].sort(),
      );
      expect(units.every((u) => u.isActive)).toBe(true);
    });

    it('AC: the seeded Litre/Kilogram are wired as derived units (mL/g base, factor 1000) — Box/Dozen/Pack/Piece stay independent base units', async () => {
      const { property } = await chainWithProperty();
      const { token } = await actor('unitowner1b@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

      const outletRes = await api()
        .post(`/api/v1/properties/${property.id}/outlets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
        .expect(201);

      const units = await prisma.unitOfMeasure.findMany({ where: { outletId: outletRes.body.id } });
      const byName = Object.fromEntries(units.map((u) => [u.name, u]));

      expect(byName.Millilitre!.baseUnitId).toBeNull();
      expect(byName.Gram!.baseUnitId).toBeNull();
      expect(byName.Litre!.baseUnitId).toBe(byName.Millilitre!.id);
      expect(byName.Litre!.conversionFactor!.toFixed(2)).toBe('1000.00');
      expect(byName.Kilogram!.baseUnitId).toBe(byName.Gram!.id);
      expect(byName.Kilogram!.conversionFactor!.toFixed(2)).toBe('1000.00');
      for (const name of ['Piece', 'Box', 'Dozen', 'Pack']) {
        expect(byName[name]!.baseUnitId).toBeNull();
        expect(byName[name]!.conversionFactor).toBeNull();
      }
    });

    it('AC: a user can add a custom unit of measure, and it immediately appears as a selectable option on the Item form', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner2@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

      const created = await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Bunch', abbreviation: 'bunch' })
        .expect(201);
      expect(created.body.isActive).toBe(true);

      const list = await api()
        .get(`/api/v1/items/units?outletId=${outlet.id}&isActive=true`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.some((u: { id: string }) => u.id === created.body.id)).toBe(true);

      // Immediately usable on a real Item, not just listed.
      const cat = await category(outlet.id);
      const item = await api()
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${token}`)
        .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: created.body.id }))
        .expect(201);
      expect(item.body.unitId).toBe(created.body.id);
    });

    it('rejects a duplicate unit name within the same outlet', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner3@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');

      await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Bunch', abbreviation: 'bunch' })
        .expect(201);

      await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Bunch', abbreviation: 'bunch2' })
        .expect(409);
    });

    it('rejects create for STORE_STAFF (view-only)', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner4@example.com', 'OUTLET', outlet.id, 'STORE_STAFF');

      await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Bunch', abbreviation: 'bunch' })
        .expect(403);
    });

    it('PATCH edits name/abbreviation', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner5@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const unit = await unitOfMeasure(outlet.id, 'Sack', 'sack');

      const updated = await api()
        .patch(`/api/v1/items/units/${unit.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ abbreviation: 'sck' })
        .expect(200);
      expect(updated.body.abbreviation).toBe('sck');
      expect(updated.body.name).toBe('Sack');
    });

    it('AC: deactivating a unit of measure does not affect any Item already using it — it only stops appearing as an option for new/edited items', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner6@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const cat = await category(outlet.id);
      const unit = await unitOfMeasure(outlet.id, 'Tray', 'tray');

      const item = await api()
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${token}`)
        .send(itemPayload({ outletId: outlet.id, categoryId: cat.id, unitId: unit.id }))
        .expect(201);

      const deactivated = await api()
        .delete(`/api/v1/items/units/${unit.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(deactivated.body.isActive).toBe(false);

      // The existing item keeps its reference untouched.
      const reloadedItem = await api()
        .get(`/api/v1/items/${item.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(reloadedItem.body.unitId).toBe(unit.id);

      // But it no longer appears in the active-only list new/edited items pick from.
      const activeUnits = await api()
        .get(`/api/v1/items/units?outletId=${outlet.id}&isActive=true`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(activeUnits.body.some((u: { id: string }) => u.id === unit.id)).toBe(false);
    });

    it('AC: creates a derived unit converting to a genuine base unit', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner7@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const gram = await unitOfMeasure(outlet.id, 'Gram', 'g');

      const created = await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Kilogram', abbreviation: 'kg', baseUnitId: gram.id, conversionFactor: '1000' })
        .expect(201);

      expect(created.body.baseUnitId).toBe(gram.id);
      expect(created.body.conversionFactor).toBe('1000.000000');
    });

    it('AC: rejects setting a Base Unit to another unit that already has its own Base Unit set (only a flat, two-level hierarchy is allowed)', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner8@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const gram = await unitOfMeasure(outlet.id, 'Gram', 'g');
      const kilogram = await unitOfMeasure(outlet.id, 'Kilogram', 'kg');
      await prisma.unitOfMeasure.update({
        where: { id: kilogram.id },
        data: { baseUnitId: gram.id, conversionFactor: '1000' },
      });

      await api()
        .post('/api/v1/items/units')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, name: 'Tonne', abbreviation: 't', baseUnitId: kilogram.id, conversionFactor: '1000' })
        .expect(400);
    });

    it('AC: rejects giving a Base Unit of its own to a unit that other units already depend on', async () => {
      const { outlet } = await chainWithOutlet();
      const { token } = await actor('unitowner9@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const gram = await unitOfMeasure(outlet.id, 'Gram', 'g');
      const millilitre = await unitOfMeasure(outlet.id, 'Millilitre', 'mL');
      const kilogram = await unitOfMeasure(outlet.id, 'Kilogram', 'kg');
      await prisma.unitOfMeasure.update({
        where: { id: kilogram.id },
        data: { baseUnitId: gram.id, conversionFactor: '1000' },
      });

      // Gram is now in use as Kilogram's base — giving Gram a base unit of
      // its own would retroactively turn Kilogram into a 3-level chain.
      await api()
        .patch(`/api/v1/items/units/${gram.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ baseUnitId: millilitre.id, conversionFactor: '1' })
        .expect(400);
    });
  });
});
