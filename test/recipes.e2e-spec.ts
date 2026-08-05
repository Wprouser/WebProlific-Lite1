import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-05's acceptance criteria end-to-end against a real (test) SQL
 * Server database, plus its FR-18 (ActivityLog/TransactionLog) wiring.
 * Requires: docker compose up -d && npm run prisma:migrate:test && npm run
 * test:e2e (targets webprolific_test via test/env-setup.ts, never the dev
 * database).
 */
describe('Recipes / BOM (FR-05) e2e', () => {
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
  });

  afterEach(async () => {
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

  async function actor(email: string, outletId: string, role: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    await prisma.userAccess.create({
      data: { userId: user.id, scopeType: 'OUTLET', scopeId: outletId, role },
    });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  let skuCounter = 0;

  async function outletFixture(name = 'Main Restaurant') {
    const chain = await prisma.chain.create({ data: { name: `Chain ${++skuCounter}` } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name, type: 'RESTAURANT' },
    });
    const category = await prisma.category.create({ data: { name: 'Dry Goods', outletId: outlet.id } });
    const unit = await prisma.unitOfMeasure.create({
      data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id },
    });
    // Derived from Kilogram so FR-01's conversion applies (1 kg = 1000 g).
    const gram = await prisma.unitOfMeasure.create({
      data: {
        name: 'Gram',
        abbreviation: 'g',
        outletId: outlet.id,
        baseUnitId: unit.id,
        conversionFactor: '0.001',
      },
    });
    const litre = await prisma.unitOfMeasure.create({
      data: { name: 'Litre', abbreviation: 'L', outletId: outlet.id },
    });
    return { outlet, category, unit, gram, litre };
  }

  async function ingredient(
    ctx: { outlet: { id: string }; category: { id: string }; unit: { id: string } },
    name: string,
    costPrice: string,
  ) {
    return prisma.item.create({
      data: {
        outletId: ctx.outlet.id,
        categoryId: ctx.category.id,
        unitId: ctx.unit.id,
        name,
        sku: `SKU-${String(++skuCounter).padStart(4, '0')}`,
        minStock: '0',
        maxStock: '1000',
        costPrice,
        currentStock: '0',
      },
    });
  }

  // -------------------------------------------------------------- AC 1

  it('AC: editing a recipe creates a new version; the old version remains queryable', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Basmati Rice', '85.50');
    const chicken = await ingredient(ctx, 'Chicken', '22.00');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Chicken Biryani' })
      .expect(201);

    const v1 = await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: rice.id, quantity: '0.2000' }] })
      .expect(201);
    expect(v1.body.version).toBe(1);

    const v2 = await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [
          { itemId: rice.id, quantity: '0.2500' },
          { itemId: chicken.id, quantity: '0.1500' },
        ],
      })
      .expect(201);
    expect(v2.body.version).toBe(2);

    const current = await api()
      .get(`/api/v1/menu-items/${menuItem.body.id}/recipes/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.version).toBe(2);
    expect(current.body.lines).toHaveLength(2);

    const history = await api()
      .get(`/api/v1/menu-items/${menuItem.body.id}/recipes/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.map((r: { version: number }) => r.version)).toEqual([2, 1]);

    // The old version is intact, not overwritten — this is what keeps a past
    // sale costed against what it actually consumed.
    const previous = history.body.find((r: { version: number }) => r.version === 1);
    expect(previous.isCurrent).toBe(false);
    expect(previous.lines).toHaveLength(1);
    expect(previous.lines[0].quantity).toBe('0.2');
  });

  it('costs a specific past version, not just the current one', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const cheap = await ingredient(ctx, 'Cheap', '1.00');
    const pricey = await ingredient(ctx, 'Pricey', '50.00');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Dish' })
      .expect(201);

    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: cheap.id, quantity: '1.0000' }] })
      .expect(201);
    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: pricey.id, quantity: '1.0000' }] })
      .expect(201);

    const currentCost = await api()
      .get(`/api/v1/menu-items/${menuItem.body.id}/cost`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(currentCost.body.totalCost).toBe('50.00');

    const v1Cost = await api()
      .get(`/api/v1/menu-items/${menuItem.body.id}/cost?version=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(v1Cost.body.totalCost).toBe('1.00');
  });

  // -------------------------------------------------------------- AC 2

  it('AC: a circular sub-recipe reference is rejected with a clear error, not a hang', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const biryani = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Biryani' })
      .expect(201);
    const masala = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Masala Base' })
      .expect(201);

    const biryaniV1 = await api()
      .post(`/api/v1/menu-items/${biryani.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '1.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: rice.id, quantity: '0.2000' }],
      })
      .expect(201);

    // Masala Base contains Biryani v1.
    await api()
      .post(`/api/v1/menu-items/${masala.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '1.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ subRecipeId: biryaniV1.body.id, quantity: '1.0000', quantityUnitId: ctx.unit.id }],
      })
      .expect(201);

    const masalaCurrent = await api()
      .get(`/api/v1/menu-items/${masala.body.id}/recipes/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Now make Biryani contain Masala Base -> Biryani would contain Biryani.
    const rejected = await api()
      .post(`/api/v1/menu-items/${biryani.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [
          { subRecipeId: masalaCurrent.body.id, quantity: '1.0000', quantityUnitId: ctx.unit.id },
        ],
      })
      .expect(400);

    expect(rejected.body.message).toMatch(/[Cc]ircular sub-recipe reference/);
    // Named in terms the user can act on, not raw uuids.
    expect(rejected.body.message).toContain('Biryani');
    expect(rejected.body.message).toContain('Masala Base');

    // And nothing was written — Biryani still has exactly one version.
    const history = await api()
      .get(`/api/v1/menu-items/${biryani.body.id}/recipes/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
  });

  it('rejects a recipe that references its own menu item directly', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Self Referential Stew' })
      .expect(201);
    const v1 = await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '1.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: rice.id, quantity: '0.1000' }],
      })
      .expect(201);

    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ subRecipeId: v1.body.id, quantity: '1.0000', quantityUnitId: ctx.unit.id }] })
      .expect(400);
  });

  it('accepts a legitimate nested sub-recipe and costs the whole tree', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato', '3.00');
    const rice = await ingredient(ctx, 'Rice', '10.00');

    const sauce = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Tomato Sauce' })
      .expect(201);
    const sauceV1 = await api()
      .post(`/api/v1/menu-items/${sauce.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        // One batch yields 1 kg from 0.5 kg of tomato.
        yieldQuantity: '1.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: tomato.id, quantity: '0.5000' }],
      })
      .expect(201);

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Rice with Sauce' })
      .expect(201);
    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [
          { itemId: rice.id, quantity: '0.2000' },
          // 2 kg of a 1 kg batch = 2 batches, same arithmetic as before but
          // now expressed as a real quantity.
          { subRecipeId: sauceV1.body.id, quantity: '2.0000', quantityUnitId: ctx.unit.id },
        ],
      })
      .expect(201);

    const cost = await api()
      .get(`/api/v1/menu-items/${dish.body.id}/cost`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // rice 0.2 x 10.00 = 2.00 ; sauce 2 batches x 0.5 x 3.00 = 3.00
    expect(cost.body.totalCost).toBe('5.00');
    expect(cost.body.components).toHaveLength(2);
  });

  // -------------------------------------------------------------- AC 3

  it('AC: cannot activate a menu item with no recipe', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Unfinished Dish' })
      .expect(201);
    expect(menuItem.body.isActive).toBe(false);

    await api()
      .patch(`/api/v1/menu-items/${menuItem.body.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('activates once a recipe with lines exists', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Plain Rice' })
      .expect(201);
    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: rice.id, quantity: '0.2000' }] })
      .expect(201);

    const activated = await api()
      .patch(`/api/v1/menu-items/${menuItem.body.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(activated.body.isActive).toBe(true);
  });

  // ------------------------------------------- yield amendment (FR-05)

  it('AC: a recipe with no yield cannot be referenced as a sub-recipe (409)', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato', '3.00');

    const sauce = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Yieldless Sauce' })
      .expect(201);
    const sauceV1 = await api()
      .post(`/api/v1/menu-items/${sauce.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: tomato.id, quantity: '0.5000' }] })
      .expect(201);

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Dish Using It' })
      .expect(201);

    const rejected = await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [{ subRecipeId: sauceV1.body.id, quantity: '0.2000', quantityUnitId: ctx.unit.id }],
      })
      .expect(409);
    expect(rejected.body.message).toMatch(/no yield set/i);
  });

  it('AC: the yield-based multiplier is computed at full precision, not pre-rounded', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    // 2 kg of tomato per 3 kg batch; the dish uses 200 g of that sauce.
    const tomato = await ingredient(ctx, 'Tomato', '1.00');

    const sauce = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Precise Sauce' })
      .expect(201);
    const sauceV1 = await api()
      .post(`/api/v1/menu-items/${sauce.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '3.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: tomato.id, quantity: '2.0000' }],
      })
      .expect(201);

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Precise Dish' })
      .expect(201);
    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [{ subRecipeId: sauceV1.body.id, quantity: '0.2000', quantityUnitId: ctx.unit.id }],
      })
      .expect(201);

    const cost = await api()
      .get(`/api/v1/menu-items/${dish.body.id}/cost`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // True value is 2 * (0.2/3) = 0.13333...; a human-entered 4dp multiplier
    // would have given 0.1334.
    const drift = Math.abs(Number(cost.body.components[0].quantity) - 2 * (0.2 / 3));
    expect(drift).toBeLessThan(1e-7);
    expect(cost.body.usesLegacyBatchMultiplier).toBe(false);
  });

  it('AC: a sub-recipe line converts from a sibling unit (kg <-> g)', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato', '3.00');

    const sauce = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Convertible Sauce' })
      .expect(201);
    const sauceV1 = await api()
      .post(`/api/v1/menu-items/${sauce.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '2.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: tomato.id, quantity: '1.5000' }],
      })
      .expect(201);

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Dish In Grams' })
      .expect(201);
    // 500 g of a 2 kg batch = a quarter batch = 0.375 kg tomato.
    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [{ subRecipeId: sauceV1.body.id, quantity: '500.0000', quantityUnitId: ctx.gram.id }],
      })
      .expect(201);

    const cost = await api()
      .get(`/api/v1/menu-items/${dish.body.id}/cost`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cost.body.components[0].quantity).toBe('0.375');
  });

  it('AC: a sub-recipe line unit from an unrelated family is rejected at save time', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato', '3.00');

    const sauce = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Mass Sauce' })
      .expect(201);
    const sauceV1 = await api()
      .post(`/api/v1/menu-items/${sauce.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        yieldQuantity: '2.0000',
        yieldUnitId: ctx.unit.id,
        lines: [{ itemId: tomato.id, quantity: '1.5000' }],
      })
      .expect(201);

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Volume Dish' })
      .expect(201);

    // Litre has no base-unit relationship to Kilogram.
    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [{ subRecipeId: sauceV1.body.id, quantity: '1.0000', quantityUnitId: ctx.litre.id }],
      })
      .expect(400);
  });

  it('AC: yieldQuantity and yieldUnitId are both-or-neither', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const dish = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Half Yield Dish' })
      .expect(201);

    await api()
      .post(`/api/v1/menu-items/${dish.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ yieldQuantity: '2.0000', lines: [{ itemId: rice.id, quantity: '0.2000' }] })
      .expect(400);
  });

  it('AC: legacy yield-less recipes still resolve, and are flagged on cost', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const tomato = await ingredient(ctx, 'Tomato', '3.00');

    // Build the legacy shape directly: a sub-recipe line with no unit,
    // pointing at a yield-less recipe. The API now refuses to create this,
    // which is the point — these rows only exist from before the amendment.
    const sauce = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Legacy Sauce' },
    });
    const sauceRecipe = await prisma.recipe.create({
      data: {
        menuItemId: sauce.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ itemId: tomato.id, quantity: '0.5000' }] },
      },
    });
    const dish = await prisma.menuItem.create({
      data: { outletId: ctx.outlet.id, name: 'Legacy Dish' },
    });
    await prisma.recipe.create({
      data: {
        menuItemId: dish.id,
        version: 1,
        isCurrent: true,
        lines: { create: [{ subRecipeId: sauceRecipe.id, quantity: '2.0000' }] },
      },
    });

    const cost = await api()
      .get(`/api/v1/menu-items/${dish.id}/cost`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 2 batches x 0.5 kg x 3.00 — exactly what it resolved to before.
    expect(cost.body.components[0].quantity).toBe('1');
    expect(cost.body.totalCost).toBe('3.00');
    expect(cost.body.usesLegacyBatchMultiplier).toBe(true);
  });

  // ------------------------------------------------- business-logic rules

  it('rejects a line with both itemId and subRecipeId', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Dish' })
      .expect(201);
    const v1 = await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: rice.id, quantity: '0.2000' }] })
      .expect(201);

    const other = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Other' })
      .expect(201);

    await api()
      .post(`/api/v1/menu-items/${other.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: rice.id, subRecipeId: v1.body.id, quantity: '1.0000' }] })
      .expect(400);
  });

  it('rejects a line with neither itemId nor subRecipeId', async () => {
    const ctx = await outletFixture();
    const { token } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Dish' })
      .expect(201);

    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ quantity: '1.0000' }] })
      .expect(400);
  });

  it('rejects an ingredient from another outlet', async () => {
    const ctxA = await outletFixture('Outlet A');
    const ctxB = await outletFixture('Outlet B');
    const foreign = await ingredient(ctxB, 'Foreign Item', '5.00');

    const user = await prisma.user.create({
      data: { email: 'multi@example.com', passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    for (const outletId of [ctxA.outlet.id, ctxB.outlet.id]) {
      await prisma.userAccess.create({
        data: { userId: user.id, scopeType: 'OUTLET', scopeId: outletId, role: 'OUTLET_MANAGER' },
      });
    }
    const token = tokenService.signAccessToken(user.id);

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctxA.outlet.id, name: 'Cross Outlet Dish' })
      .expect(201);

    // The caller legitimately has access to both outlets, so route-level
    // scoping can't catch this — only the service check can.
    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: foreign.id, quantity: '1.0000' }] })
      .expect(400);
  });

  it('denies a caller with no access to the outlet', async () => {
    const ctxA = await outletFixture('Outlet A');
    const ctxB = await outletFixture('Outlet B');
    const { token } = await actor('outsider@example.com', ctxB.outlet.id, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctxA.outlet.id, name: 'Not Yours' })
      .expect(403);
  });

  // ------------------------------------------------------------- FR-18

  it('writes ActivityLog and TransactionLog rows for recipe changes', async () => {
    const ctx = await outletFixture();
    const { token, userId } = await actor('chef@example.com', ctx.outlet.id, 'OUTLET_MANAGER');
    const rice = await ingredient(ctx, 'Rice', '85.50');

    const menuItem = await api()
      .post('/api/v1/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: ctx.outlet.id, name: 'Logged Dish' })
      .expect(201);
    await api()
      .post(`/api/v1/menu-items/${menuItem.body.id}/recipes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ itemId: rice.id, quantity: '0.2000' }] })
      .expect(201);

    const activity = await prisma.activityLog.findMany({ where: { userId } });
    const categories = new Set(activity.map((a) => a.category));
    // FR-18: recipe work belongs in its own feed bucket, not SETTINGS.
    expect(categories).toContain('RECIPE');
    expect(activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CREATE_MENU_ITEM', 'CREATE_RECIPE']),
    );

    const transactions = await prisma.transactionLog.findMany();
    expect(transactions.length).toBeGreaterThan(0);
    expect(transactions.every((t) => t.entityCategory === 'MASTER_DATA')).toBe(true);
  });
});
