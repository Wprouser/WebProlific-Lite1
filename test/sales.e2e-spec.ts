import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import { signPayload } from '../src/sales/lib/verify-pos-signature';

const POS_SECRET = process.env.POS_WEBHOOK_SECRET ?? 'test-pos-secret';

/**
 * Exercises FR-06's acceptance criteria end-to-end against a real (test) SQL
 * Server database. Requires: docker compose up -d && npm run
 * prisma:migrate:test && npm run test:e2e (targets webprolific_test via
 * test/env-setup.ts, never the dev database).
 */
describe('POS Auto-Deduction (FR-06) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mirrors main.ts: the webhook's HMAC is verified against the raw bytes,
    // so the same verify hook has to be installed here or every signed
    // request would fail for want of a rawBody.
    app.use(
      express.json({
        verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
          req.rawBody = Buffer.from(buf);
        },
      }),
    );
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
  });

  afterEach(async () => {
    await prisma.saleImportRow.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.saleImportBatch.deleteMany();
    await prisma.recipeLine.deleteMany();
    await prisma.recipe.deleteMany();
    await prisma.menuItem.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.unitOfMeasure.deleteMany();
    await prisma.category.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.outlet.deleteMany();
    await prisma.property.deleteMany();
    await prisma.chain.deleteMany();
    await prisma.user.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  /** Signs the body the way a real POS would, over the exact bytes sent. */
  function signedPost(path: string, body: unknown, secret = POS_SECRET) {
    const raw = JSON.stringify(body);
    return api()
      .post(path)
      .set('Content-Type', 'application/json')
      .set('X-Pos-Signature', signPayload(raw, secret))
      .send(raw);
  }

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
    return { outlet, category, unit };
  }

  async function ingredient(
    ctx: { outlet: { id: string }; category: { id: string }; unit: { id: string } },
    name: string,
    currentStock = '100.000',
  ) {
    return prisma.item.create({
      data: {
        outletId: ctx.outlet.id,
        categoryId: ctx.category.id,
        unitId: ctx.unit.id,
        name,
        sku: `SKU-${String(++seq).padStart(4, '0')}`,
        minStock: '0',
        maxStock: '1000',
        costPrice: '10.00',
        currentStock,
      },
    });
  }

  /** A menu item with a single-ingredient current recipe. */
  async function dish(
    ctx: { outlet: { id: string } },
    name: string,
    itemId: string,
    quantity = '0.2500',
  ) {
    const menuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name, isActive: true },
    });
    const recipe = await prisma.recipe.create({
      data: {
        menuItemId: menuItem.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ itemId, quantity }] },
      },
    });
    return { menuItem, recipe };
  }

  async function stockOf(itemId: string) {
    return (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).currentStock.toFixed(3);
  }

  // ------------------------------------------------------------ webhook auth

  it('rejects an unsigned or wrongly-signed webhook, and never moves stock for it', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);
    const body = {
      posReferenceId: 'pos-unsigned',
      menuItemId: menuItem.id,
      quantitySold: 2,
      timestamp: '2026-07-20T12:34:00Z',
    };

    await api().post('/api/v1/pos-webhook/sale').send(body).expect(401);
    await signedPost('/api/v1/pos-webhook/sale', body, 'the-wrong-secret').expect(401);

    expect(await stockOf(rice.id)).toBe('100.000');
    expect(await prisma.sale.count()).toBe(0);
  });

  it('rejects a body altered after signing', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);

    const signed = JSON.stringify({
      posReferenceId: 'pos-tamper',
      menuItemId: menuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    });
    const tampered = signed.replace('"quantitySold":1', '"quantitySold":500');

    await api()
      .post('/api/v1/pos-webhook/sale')
      .set('Content-Type', 'application/json')
      .set('X-Pos-Signature', signPayload(signed, POS_SECRET))
      .send(tampered)
      .expect(401);
  });

  // ---------------------------------------------------------------- AC 1

  it('AC: replaying the same webhook payload twice does not double-deduct stock', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id, '0.2500');
    const body = {
      posReferenceId: 'pos-txn-88213',
      menuItemId: menuItem.id,
      quantitySold: 2,
      timestamp: '2026-07-20T12:34:00Z',
    };

    const first = await signedPost('/api/v1/pos-webhook/sale', body).expect(200);
    expect(first.body).toMatchObject({ alreadyProcessed: false, deducted: true, recipeVersionUsed: 1 });
    expect(await stockOf(rice.id)).toBe('99.500'); // 100 - (0.25 x 2)

    const second = await signedPost('/api/v1/pos-webhook/sale', body).expect(200);
    expect(second.body).toMatchObject({ alreadyProcessed: true, deducted: false });

    expect(await stockOf(rice.id)).toBe('99.500');
    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.stockTransaction.count({ where: { referenceType: 'SALE' } })).toBe(1);
  });

  it('records the deduction with no user, referencing the sale', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);

    const response = await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-actor',
      menuItemId: menuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    const transaction = await prisma.stockTransaction.findFirstOrThrow({
      where: { referenceType: 'SALE' },
    });
    expect(transaction.performedById).toBeNull();
    expect(transaction.referenceId).toBe(response.body.saleId);
    expect(transaction.type).toBe('USAGE_OUT');
  });

  // ---------------------------------------------------------------- AC 2

  it('AC: a sale for a menu item with no recipe does not 5xx — it is skipped with a warning', async () => {
    const ctx = await outletFixture();
    const menuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Unmapped Dish', isActive: true },
    });

    const response = await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-no-recipe',
      menuItemId: menuItem.id,
      quantitySold: 3,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    expect(response.body).toMatchObject({ deducted: false, recipeVersionUsed: null });
    expect(response.body.warnings).toEqual([
      expect.objectContaining({ code: 'RECIPE_MISSING', message: expect.stringContaining('Unmapped Dish') }),
    ]);

    // The sale itself is still recorded — that is what puts it on the worklist.
    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.stockTransaction.count()).toBe(0);
    const warning = await prisma.activityLog.findFirstOrThrow({ where: { action: 'RECIPE_MISSING' } });
    expect(warning).toMatchObject({ category: 'ALERT', entityType: 'MenuItem', entityId: menuItem.id, userId: null });
  });

  it('surfaces unmapped menu items on the worklist, with counts', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const menuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Unmapped Dish', isActive: true },
    });

    for (const [index, quantity] of [2, 3].entries()) {
      await signedPost('/api/v1/pos-webhook/sale', {
        posReferenceId: `pos-unmapped-${index}`,
        menuItemId: menuItem.id,
        quantitySold: quantity,
        timestamp: '2026-07-20T12:34:00Z',
      }).expect(200);
    }

    const worklist = await api()
      .get('/api/v1/sales/unmapped')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(worklist.body).toEqual([
      expect.objectContaining({
        menuItemId: menuItem.id,
        menuItemName: 'Unmapped Dish',
        saleCount: 2,
        totalQuantitySold: '5.000',
      }),
    ]);
  });

  // ---------------------------------------------------------------- AC 3

  it('AC: voiding a sale reverses all ingredient deductions, including sub-recipe items', async () => {
    const ctx = await outletFixture();
    const tomato = await ingredient(ctx, 'Tomato', '50.000');
    const rice = await ingredient(ctx, 'Rice', '50.000');

    // Sauce: a sub-recipe with a real yield (2 kg per batch, 1.5 kg tomato).
    const sauceMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'House Sauce' },
    });
    const sauce = await prisma.recipe.create({
      data: {
        menuItemId: sauceMenuItem.id,
        version: 1,
        isCurrent: true,
        yieldQuantity: '2.0000',
        yieldUnitId: ctx.unit.id,
        lines: { create: [{ itemId: tomato.id, quantity: '1.5000' }] },
      },
    });

    // Dish: 0.25 kg rice + 0.5 kg of that sauce (a quarter batch -> 0.375 kg tomato).
    const dishMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Biryani', isActive: true },
    });
    await prisma.recipe.create({
      data: {
        menuItemId: dishMenuItem.id,
        version: 1,
        isCurrent: true,
        lines: {
          create: [
            { itemId: rice.id, quantity: '0.2500' },
            { subRecipeId: sauce.id, quantity: '0.5000', quantityUnitId: ctx.unit.id },
          ],
        },
      },
    });

    await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-void-me',
      menuItemId: dishMenuItem.id,
      quantitySold: 2,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    expect(await stockOf(rice.id)).toBe('49.500'); // 50 - 0.25 x 2
    expect(await stockOf(tomato.id)).toBe('49.250'); // 50 - 0.375 x 2

    const voided = await signedPost('/api/v1/pos-webhook/void', {
      posReferenceId: 'pos-void-me',
    }).expect(200);
    expect(voided.body).toEqual({ voided: true, reversedCount: 2 });

    expect(await stockOf(rice.id)).toBe('50.000');
    expect(await stockOf(tomato.id)).toBe('50.000');
    expect((await prisma.sale.findFirstOrThrow()).isVoid).toBe(true);
  });

  it('a repeated void does not reverse twice', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);

    await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-double-void',
      menuItemId: menuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    await signedPost('/api/v1/pos-webhook/void', { posReferenceId: 'pos-double-void' }).expect(200);
    const second = await signedPost('/api/v1/pos-webhook/void', {
      posReferenceId: 'pos-double-void',
    }).expect(200);

    expect(second.body).toEqual({ voided: false, reversedCount: 0 });
    expect(await stockOf(rice.id)).toBe('100.000');
  });

  it('voids a batch-imported sale by its generated reference, same as a webhook one', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id);

    const upload = await api()
      .post('/api/v1/sales/import-batches')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', ctx.outlet.id)
      .attach('file', Buffer.from('Menu Item,Qty,Date\nChicken Biryani,4,2026-07-20'), 'daily.csv')
      .expect(201);

    await api()
      .post(`/api/v1/sales/import-batches/${upload.body.batch.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(await stockOf(rice.id)).toBe('99.000'); // 100 - 0.25 x 4

    const sale = await prisma.sale.findFirstOrThrow();
    await signedPost('/api/v1/pos-webhook/void', { posReferenceId: sale.posReferenceId }).expect(200);
    expect(await stockOf(rice.id)).toBe('100.000');
  });

  // --------------------------------------------- legacy yield-less deduction

  it('deducts through a yield-less sub-recipe rather than blocking, and warns naming it', async () => {
    const ctx = await outletFixture();
    const tomato = await ingredient(ctx, 'Tomato', '50.000');

    // Legacy shape: no yield, and the parent line carries no unit. The API
    // refuses to create this now, so it only exists from before the amendment.
    const sauceMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Legacy Sauce' },
    });
    const sauce = await prisma.recipe.create({
      data: {
        menuItemId: sauceMenuItem.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ itemId: tomato.id, quantity: '0.5000' }] },
      },
    });
    const dishMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Legacy Dish', isActive: true },
    });
    await prisma.recipe.create({
      data: {
        menuItemId: dishMenuItem.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ subRecipeId: sauce.id, quantity: '2.0000' }] },
      },
    });

    const response = await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-legacy',
      menuItemId: dishMenuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    // An imprecise-but-real deduction: 2 batches x 0.5 kg.
    expect(response.body.deducted).toBe(true);
    expect(await stockOf(tomato.id)).toBe('49.000');

    expect(response.body.warnings).toEqual([
      expect.objectContaining({
        code: 'LEGACY_RECIPE_DEDUCTION',
        message: expect.stringContaining('Legacy Sauce'),
      }),
    ]);
    const warning = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'LEGACY_RECIPE_DEDUCTION' },
    });
    // Logged against the sub-recipe's own menu item — the row to go fix.
    expect(warning).toMatchObject({ category: 'ALERT', entityId: sauceMenuItem.id });
  });

  it('flags the offending menu item with needsYield, so the badge has something to show', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato');

    const sauceMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Legacy Sauce' },
    });
    const sauce = await prisma.recipe.create({
      data: {
        menuItemId: sauceMenuItem.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ itemId: tomato.id, quantity: '0.5000' }] },
      },
    });
    const dishMenuItem = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Dish', isActive: true },
    });
    await prisma.recipe.create({
      data: {
        menuItemId: dishMenuItem.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ subRecipeId: sauce.id, quantity: '2.0000' }] },
      },
    });

    const list = await api().get('/api/v1/menu-items').set('Authorization', `Bearer ${token}`).expect(200);
    const bySauce = list.body.find((row: { id: string }) => row.id === sauceMenuItem.id);
    const byDish = list.body.find((row: { id: string }) => row.id === dishMenuItem.id);

    expect(bySauce.needsYield).toBe(true);
    // The dish's own recipe has no yield either, but nothing consumes it as a
    // sub-recipe, so it is not the thing that needs fixing.
    expect(byDish.needsYield).toBe(false);
  });

  // ------------------------------------------------------------- overselling

  it('records an oversell as a negative balance rather than failing the webhook', async () => {
    const ctx = await outletFixture();
    const rice = await ingredient(ctx, 'Rice', '0.100');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id, '0.2500');

    const response = await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-oversell',
      menuItemId: menuItem.id,
      quantitySold: 2,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    expect(response.body.deducted).toBe(true);
    expect(await stockOf(rice.id)).toBe('-0.400'); // 0.1 - 0.5
    expect(response.body.warnings).toEqual([
      expect.objectContaining({ code: 'NEGATIVE_STOCK_ON_SALE' }),
    ]);
  });

  // --------------------------------------------------------- batch import AC

  const CSV = [
    'Menu Item,Quantity Sold,Sale Date',
    'Chicken Biryani,4,2026-07-20',
    'Mystery Special,2,2026-07-20',
  ].join('\n');

  async function uploadBatch(ctx: { outlet: { id: string } }, token: string, csv = CSV) {
    return api()
      .post('/api/v1/sales/import-batches')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', ctx.outlet.id)
      .attach('file', Buffer.from(csv), 'daily-sales.csv')
      .expect(201);
  }

  it('AC: uploading a daily sales file creates a STAGED batch with zero stock impact', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id);

    const upload = await uploadBatch(ctx, token);

    expect(upload.body.batch).toMatchObject({ status: 'STAGED', totalRows: 2, processedRows: 0 });
    expect(await stockOf(rice.id)).toBe('100.000');
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.stockTransaction.count()).toBe(0);
  });

  it('AC: the review screen shows a projected ingredient-impact preview before committing', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id, '0.2500');

    const upload = await uploadBatch(ctx, token);
    const review = await api()
      .get(`/api/v1/sales/import-batches/${upload.body.batch.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(review.body).toMatchObject({ matchedCount: 1, unmatchedCount: 1 });
    expect(review.body.projectedImpact).toEqual([
      expect.objectContaining({
        itemId: rice.id,
        itemName: 'Rice',
        quantity: '1', // 0.25 x 4
        currentStock: '100.000',
        projectedStock: '99',
      }),
    ]);
    // Still nothing deducted by looking at it.
    expect(await stockOf(rice.id)).toBe('100.000');
  });

  it('AC: an unmatched row can be corrected inline, without re-uploading the file', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id);
    const { menuItem: special } = await dish(ctx, 'Seasonal Special', rice.id);

    const upload = await uploadBatch(ctx, token);
    const batchId = upload.body.batch.id;

    const before = await api()
      .get(`/api/v1/sales/import-batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const unmatched = before.body.rows.find(
      (row: { matchStatus: string }) => row.matchStatus === 'UNMATCHED',
    );
    expect(unmatched.rawMenuItemName).toBe('Mystery Special');

    const corrected = await api()
      .patch(`/api/v1/sales/import-batches/${batchId}/rows/${unmatched.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: special.id })
      .expect(200);

    expect(corrected.body).toMatchObject({
      matchStatus: 'MANUAL',
      matchedMenuItemId: special.id,
      matchedMenuItemName: 'Seasonal Special',
    });

    const after = await api()
      .get(`/api/v1/sales/import-batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body).toMatchObject({ matchedCount: 2, unmatchedCount: 0 });
  });

  it('AC: the import flow never deducts stock until Run BOM is explicitly triggered', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id, '0.2500');

    const upload = await uploadBatch(ctx, token);
    const batchId = upload.body.batch.id;

    // Upload happened, review happened — still untouched.
    await api()
      .get(`/api/v1/sales/import-batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await stockOf(rice.id)).toBe('100.000');

    const run = await api()
      .post(`/api/v1/sales/import-batches/${batchId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(await stockOf(rice.id)).toBe('99.000');
    // One row matched and ran; the unmatched "Mystery Special" was skipped
    // without stopping it.
    expect(run.body).toMatchObject({ processedRows: 1, skippedRows: 1 });
    expect(run.body.batch.status).toBe('COMPLETED_WITH_WARNINGS');
  });

  it('AC: a single unmapped row does not halt the rest of a batch run', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id, '0.2500');
    // Matched by name, but has no recipe at all.
    await prisma.menuItem.create({ data: { outletId: ctx.outlet.id, name: 'Mystery Special' } });

    const upload = await uploadBatch(ctx, token);
    const run = await api()
      .post(`/api/v1/sales/import-batches/${upload.body.batch.id}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Both rows recorded as sales; only the one with a recipe deducted.
    expect(run.body.processedRows).toBe(2);
    expect(await prisma.sale.count()).toBe(2);
    expect(await stockOf(rice.id)).toBe('99.000');
    expect(run.body.warnings).toEqual([expect.objectContaining({ action: 'RECIPE_MISSING' })]);
  });

  it('AC: re-running an already-completed batch does not double-deduct', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id, '0.2500');

    const upload = await uploadBatch(ctx, token);
    const batchId = upload.body.batch.id;

    await api()
      .post(`/api/v1/sales/import-batches/${batchId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(await stockOf(rice.id)).toBe('99.000');

    await api()
      .post(`/api/v1/sales/import-batches/${batchId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(await stockOf(rice.id)).toBe('99.000');
    expect(await prisma.sale.count()).toBe(1);
  });

  it('reports lines that were not sale rows, without rejecting the whole file', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id);

    const upload = await uploadBatch(
      ctx,
      token,
      'Menu Item,Quantity Sold,Sale Date\nChicken Biryani,4,2026-07-20\nGRAND TOTAL,,',
    );

    expect(upload.body.batch.totalRows).toBe(1);
    expect(upload.body.skippedLines).toEqual([
      expect.objectContaining({ lineNumber: 3, reason: expect.stringContaining('not a positive number') }),
    ]);
  });

  it('honours the uploader\'s chosen date format end-to-end', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    await dish(ctx, 'Chicken Biryani', rice.id);

    const upload = await api()
      .post('/api/v1/sales/import-batches')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', ctx.outlet.id)
      .field('dateFormat', 'MM/DD/YYYY')
      .attach('file', Buffer.from('Menu Item,Qty,Date\nChicken Biryani,1,03/04/2026'), 'daily.csv')
      .expect(201);

    const review = await api()
      .get(`/api/v1/sales/import-batches/${upload.body.batch.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Month-first: 4 March, not 3 April.
    expect(review.body.rows[0].saleDate).toBe('2026-03-04T00:00:00.000Z');
  });

  it('rejects an unknown date format rather than quietly falling back', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/sales/import-batches')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', ctx.outlet.id)
      .field('dateFormat', 'DD.MM.YY')
      .attach('file', Buffer.from('Menu Item,Qty,Date\nChicken Biryani,1,2026-07-20'), 'daily.csv')
      .expect(400);
  });

  it('rejects a file it cannot read at all, rather than staging an empty batch', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/sales/import-batches')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', ctx.outlet.id)
      .attach('file', Buffer.from('this is not a sales export at all'), 'notes.csv')
      .expect(400);

    expect(await prisma.saleImportBatch.count()).toBe(0);
  });

  it('refuses to edit a batch that has already been run', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Chicken Biryani', rice.id);

    const upload = await uploadBatch(ctx, token);
    const batchId = upload.body.batch.id;
    const review = await api()
      .get(`/api/v1/sales/import-batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const unmatched = review.body.rows.find((row: { matchStatus: string }) => row.matchStatus === 'UNMATCHED');

    await api()
      .post(`/api/v1/sales/import-batches/${batchId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await api()
      .patch(`/api/v1/sales/import-batches/${batchId}/rows/${unmatched.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: menuItem.id })
      .expect(409);
  });

  // ------------------------------------------------------ manual entry + list

  it('records a manual sale and deducts through the same path', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'CHEF');
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id, '0.2500');

    const response = await api()
      .post('/api/v1/sales/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: menuItem.id, quantitySold: '2' })
      .expect(201);

    expect(response.body.deducted).toBe(true);
    expect(response.body.sale.sourceType).toBe('MANUAL');
    expect(await stockOf(rice.id)).toBe('99.500');
  });

  it('refuses a manual sale from a role with no access to that outlet', async () => {
    const ctx = await outletFixture();
    const other = await outletFixture();
    const { token } = await actor('outsider@example.com', other.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);

    await api()
      .post('/api/v1/sales/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: menuItem.id, quantitySold: '1' })
      .expect(403);
    expect(await stockOf(rice.id)).toBe('100.000');
  });

  it('lists sales scoped to the caller, filterable by source', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('mgr@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice');
    const { menuItem } = await dish(ctx, 'Biryani', rice.id);

    await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-list-1',
      menuItemId: menuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);
    await api()
      .post('/api/v1/sales/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: menuItem.id, quantitySold: '1' })
      .expect(201);

    const all = await api().get('/api/v1/sales').set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body).toHaveLength(2);
    expect(all.body[0].menuItemName).toBe('Biryani');

    const webhookOnly = await api()
      .get('/api/v1/sales?sourceType=WEBHOOK')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(webhookOnly.body).toHaveLength(1);
    expect(webhookOnly.body[0].sourceType).toBe('WEBHOOK');
  });

  it('does not leak another outlet\'s sales', async () => {
    const mine = await outletFixture();
    const theirs = await outletFixture();
    const { token } = await actor('mgr@example.com', mine.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(theirs, 'Rice');
    const { menuItem } = await dish(theirs, 'Their Biryani', rice.id);

    await signedPost('/api/v1/pos-webhook/sale', {
      posReferenceId: 'pos-other-outlet',
      menuItemId: menuItem.id,
      quantitySold: 1,
      timestamp: '2026-07-20T12:34:00Z',
    }).expect(200);

    const list = await api().get('/api/v1/sales').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body).toEqual([]);
  });
});
