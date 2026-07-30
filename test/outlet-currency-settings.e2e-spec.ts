import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * FR-16: GET/PATCH /outlets/:id/currency-settings. The PATCH half is
 * CHAIN_OWNER-only and blocked (409) once the outlet has any transactional
 * history — checked against StockTransaction only today, since PO/GRN
 * (FR-03/04) aren't built yet (see OutletsService.updateCurrencySettings).
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Outlet Currency Settings (FR-16) e2e', () => {
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
    await prisma.auditLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.item.deleteMany();
    await prisma.category.deleteMany();
    await prisma.taxRateComponent.deleteMany();
    await prisma.taxRate.deleteMany();
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

  async function setupOutlet(baseCurrency = 'SAR') {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT', baseCurrency },
    });
    return { chain, property, outlet };
  }

  it('AC: GET returns the outlet base currency plus every registered currency code', async () => {
    const { chain, outlet } = await setupOutlet('SAR');
    const { token } = await actor('owner@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    const res = await api()
      .get(`/api/v1/outlets/${outlet.id}/currency-settings`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.baseCurrency).toBe('SAR');
    expect(res.body.supportedCurrencies).toEqual(expect.arrayContaining(['SAR', 'AED', 'USD', 'INR', 'EUR', 'GBP']));
  });

  it('AC: CHAIN_OWNER can change the base currency when the outlet has no transactional history', async () => {
    const { chain, outlet } = await setupOutlet('SAR');
    const { token } = await actor('owner2@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    const res = await api()
      .patch(`/api/v1/outlets/${outlet.id}/currency-settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'USD' })
      .expect(200);

    expect(res.body.baseCurrency).toBe('USD');
    const reloaded = await prisma.outlet.findUnique({ where: { id: outlet.id } });
    expect(reloaded?.baseCurrency).toBe('USD');
  });

  it('AC: PROPERTY_MANAGER cannot change the base currency, even though they can manage the outlet otherwise', async () => {
    const { property, outlet } = await setupOutlet('SAR');
    const { token } = await actor('mgr@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

    await api()
      .patch(`/api/v1/outlets/${outlet.id}/currency-settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'USD' })
      .expect(403);
  });

  it('AC: the generic PATCH /outlets/:id no longer accepts baseCurrency at all (closed back door)', async () => {
    const { chain, outlet } = await setupOutlet('SAR');
    const { token } = await actor('owner3@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    // forbidNonWhitelisted rejects any property class-validator doesn't
    // recognize on UpdateOutletDto — baseCurrency was deliberately removed.
    await api()
      .patch(`/api/v1/outlets/${outlet.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'USD' })
      .expect(400);

    const reloaded = await prisma.outlet.findUnique({ where: { id: outlet.id } });
    expect(reloaded?.baseCurrency).toBe('SAR');
  });

  it('AC: blocks the change with 409 and a plain-language message once the outlet has transactional history', async () => {
    const { chain, property, outlet } = await setupOutlet('SAR');
    const { token, userId } = await actor('owner4@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
    void property;

    const category = await prisma.category.create({ data: { name: 'Produce', outletId: outlet.id } });
    const unit = await prisma.unitOfMeasure.create({ data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id } });
    const item = await prisma.item.create({
      data: {
        outletId: outlet.id,
        categoryId: category.id,
        unitId: unit.id,
        name: 'Tomatoes',
        sku: 'TOM-001',
        minStock: '1',
        maxStock: '100',
        costPrice: '5.00',
      },
    });
    await prisma.stockTransaction.create({
      data: {
        outletId: outlet.id,
        itemId: item.id,
        type: 'OPENING_BALANCE',
        quantity: '10.000',
        balanceAfter: '10.000',
        performedById: userId,
      },
    });

    const res = await api()
      .patch(`/api/v1/outlets/${outlet.id}/currency-settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'USD' })
      .expect(409);

    expect(res.body.message).toMatch(/Base currency can't be changed once transactions exist/);
    const reloaded = await prisma.outlet.findUnique({ where: { id: outlet.id } });
    expect(reloaded?.baseCurrency).toBe('SAR');
  });

  it('rejects an unknown target currency', async () => {
    const { chain, outlet } = await setupOutlet('SAR');
    const { token } = await actor('owner5@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    await api()
      .patch(`/api/v1/outlets/${outlet.id}/currency-settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'ZZZ' })
      .expect(404);
  });
});
