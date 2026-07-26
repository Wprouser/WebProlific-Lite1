import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-03's Supplier Management end-to-end. PurchaseOrder/GRN
 * (FR-04) aren't built yet, so the delete-blocked-by-open-PO check and
 * SupplierPriceHistory writes are no-ops today (see SuppliersService) —
 * this suite covers everything else the spec defines.
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Suppliers (FR-03) e2e', () => {
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
    await prisma.supplierPriceHistory.deleteMany();
    await prisma.supplier.deleteMany();
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

  async function setupOutlet(email: string, role = 'OUTLET_MANAGER') {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' },
    });
    const { token } = await actor(email, 'OUTLET', outlet.id, role);
    return { token, outletId: outlet.id };
  }

  it('AC: creates a supplier with a tax registration number and preferred currency set', async () => {
    const { token, outletId } = await setupOutlet('supplier1@example.com');

    const res = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'Al-Fahad Trading',
        supplierCode: 'SUP-001',
        stateOrProvince: 'Riyadh',
        countryCode: 'SA',
        preferredCurrency: 'SAR',
        taxRegistrationType: 'VAT Reg. No.',
        taxRegistrationNumber: '300123456700003',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Al-Fahad Trading',
      supplierCode: 'SUP-001',
      stateOrProvince: 'Riyadh',
      preferredCurrency: 'SAR',
      taxRegistrationType: 'VAT Reg. No.',
      taxRegistrationNumber: '300123456700003',
      isActive: true,
    });
  });

  it('AC: a supplier can be saved with no tax registration fields at all', async () => {
    const { token, outletId } = await setupOutlet('supplier2@example.com');
    const res = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Small Local Supplier' })
      .expect(201);

    expect(res.body.taxRegistrationType).toBeNull();
    expect(res.body.taxRegistrationNumber).toBeNull();
  });

  it('rejects an unknown preferredCurrency code', async () => {
    const { token, outletId } = await setupOutlet('supplier3@example.com');
    await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Bad Currency Co', preferredCurrency: 'ZZZ' })
      .expect(404);
  });

  it('AC: OUTLET_MANAGER can create a supplier (broader role set than Tax Rate/Currency)', async () => {
    const { token, outletId } = await setupOutlet('supplier4@example.com', 'OUTLET_MANAGER');
    await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Outlet Managed Supplier' })
      .expect(201);
  });

  it('rejects STORE_STAFF attempting to create a supplier', async () => {
    const { token, outletId } = await setupOutlet('supplier5@example.com', 'STORE_STAFF');
    await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Should Not Save' })
      .expect(403);
  });

  it('lists and searches suppliers by name/code', async () => {
    const { token, outletId } = await setupOutlet('supplier6@example.com');
    await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Al-Fahad Trading', supplierCode: 'SUP-100' })
      .expect(201);
    await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Jeddah Fresh Produce', supplierCode: 'SUP-101' })
      .expect(201);

    const res = await api()
      .get('/api/v1/suppliers?search=fahad')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Al-Fahad Trading');
  });

  it('updates a supplier', async () => {
    const { token, outletId } = await setupOutlet('supplier7@example.com');
    const created = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Al-Fahad Trading' })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+966500000000' })
      .expect(200);
    expect(res.body.phone).toBe('+966500000000');
  });

  it('AC: soft-deactivates (isActive: false), never hard-deletes', async () => {
    const { token, outletId } = await setupOutlet('supplier8@example.com');
    const created = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Al-Fahad Trading' })
      .expect(201);

    const res = await api()
      .delete(`/api/v1/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.isActive).toBe(false);

    const stillThere = await prisma.supplier.findUnique({ where: { id: created.body.id } });
    expect(stillThere).not.toBeNull();
  });

  it('AC: price history is empty until GRN (FR-04) exists — no write path yet', async () => {
    const { token, outletId } = await setupOutlet('supplier9@example.com');
    const created = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Al-Fahad Trading' })
      .expect(201);

    const res = await api()
      .get(`/api/v1/suppliers/${created.body.id}/price-history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('AC: performance returns an honest empty baseline, not a fabricated score', async () => {
    const { token, outletId } = await setupOutlet('supplier10@example.com');
    const created = await api()
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, name: 'Al-Fahad Trading' })
      .expect(201);

    const res = await api()
      .get(`/api/v1/suppliers/${created.body.id}/performance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ totalGrns: 0, onTimeRate: null, priceConsistencyScore: null });
  });
});
