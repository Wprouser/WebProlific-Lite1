import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises the minimal FR-04/FR-16 TaxRate slice end-to-end: seeding on
 * outlet creation (DefaultTaxRatesListener), GET /tax-rates, and Item's
 * defaultTaxRateId round-tripping through a real seeded rate. Requires:
 *   docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Tax Rates (FR-04/FR-16 minimal slice) e2e', () => {
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
    await prisma.auditLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.taxRateComponent.deleteMany();
    await prisma.taxRate.deleteMany();
    await prisma.item.deleteMany();
    await prisma.category.deleteMany();
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

  async function chainWithProperty() {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    return { chain, property };
  }

  it('AC: creating a SAR-currency outlet via the real API auto-seeds VAT 15% / Zero-Rated, none marked isDefault', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr1@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

    const res = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);

    const rates = await prisma.taxRate.findMany({ where: { outletId: res.body.id } });
    expect(rates.map((r) => r.name).sort()).toEqual(['VAT 15%', 'Zero-Rated']);
    expect(rates.every((r) => r.isDefault === false)).toBe(true);
    const vat = rates.find((r) => r.name === 'VAT 15%')!;
    expect(vat.ratePercent.toString()).toBe('15');
    expect(vat.countryCode).toBe('SA');
    expect(vat.isCompound).toBe(false);
  });

  it('AC: creating an AED-currency outlet seeds UAE VAT 5%, not the Saudi set', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr-aed@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

    const res = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dubai Outlet', type: 'RESTAURANT', baseCurrency: 'AED' })
      .expect(201);

    const rates = await prisma.taxRate.findMany({ where: { outletId: res.body.id } });
    expect(rates.map((r) => r.name)).toEqual(['VAT 5%']);
    expect(rates[0]!.countryCode).toBe('AE');
  });

  it('AC: creating an INR-currency outlet seeds GST slabs (Intra/Inter-state compound rates), not Saudi VAT', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr-inr@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

    const res = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mumbai Outlet', type: 'RESTAURANT', baseCurrency: 'INR' })
      .expect(201);

    const rates = await prisma.taxRate.findMany({
      where: { outletId: res.body.id },
      include: { components: true },
      orderBy: { name: 'asc' },
    });
    expect(rates.map((r) => r.name).sort()).toEqual([
      'GST 12% (Inter-state)',
      'GST 12% (Intra-state)',
      'GST 18% (Inter-state)',
      'GST 18% (Intra-state)',
      'GST 28% (Inter-state)',
      'GST 28% (Intra-state)',
      'GST 5% (Inter-state)',
      'GST 5% (Intra-state)',
    ]);
    expect(rates.every((r) => r.isCompound)).toBe(true);
    expect(rates.some((r) => r.name === 'VAT 15%')).toBe(false);

    const intra18 = rates.find((r) => r.name === 'GST 18% (Intra-state)')!;
    expect(intra18.components.map((c) => `${c.componentName} ${c.componentRate.toString()}`).sort()).toEqual([
      'CGST 9',
      'SGST 9',
    ]);

    const inter18 = rates.find((r) => r.name === 'GST 18% (Inter-state)')!;
    expect(inter18.components).toHaveLength(1);
    expect(inter18.components[0]!.componentName).toBe('IGST');
    expect(inter18.components[0]!.componentRate.toString()).toBe('18');
  });

  it('GET /tax-rates returns only the seeded rates for the caller\'s accessible outlet', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr2@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outlet = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);

    const res = await api()
      .get('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((r: { name: string }) => r.name).sort()).toEqual(['VAT 15%', 'Zero-Rated']);
  });

  it('AC: selecting a seeded tax rate on an item persists to Item.defaultTaxRateId and round-trips through update', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr3@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    const outletId = outletRes.body.id;

    const taxRatesRes = await api()
      .get('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const vatRate = taxRatesRes.body.find((r: { name: string }) => r.name === 'VAT 15%');

    // Already auto-seeded by DefaultCategoriesListener via the same
    // outlet.created event used above — don't create a duplicate.
    const cat = await prisma.category.findFirstOrThrow({ where: { outletId } });

    const created = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'Basmati Rice',
        categoryId: cat.id,
        sku: 'RICE-BAS-001',
        unit: 'KG',
        minStock: '10',
        maxStock: '100',
        costPrice: '85.50',
        defaultTaxRateId: vatRate.id,
      })
      .expect(201);
    expect(created.body.defaultTaxRateId).toBe(vatRate.id);

    const fetched = await api()
      .get(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.defaultTaxRateId).toBe(vatRate.id);

    const zeroRated = taxRatesRes.body.find((r: { name: string }) => r.name === 'Zero-Rated');
    const updated = await api()
      .patch(`/api/v1/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultTaxRateId: zeroRated.id })
      .expect(200);
    expect(updated.body.defaultTaxRateId).toBe(zeroRated.id);
  });

  // ---------------------------------------------------------------------
  // Tax Configuration Screen (FR-04) — POST/PATCH/DELETE
  // ---------------------------------------------------------------------

  it('AC: POST /tax-rates creates a new rate for PROPERTY_MANAGER/CHAIN_OWNER only', async () => {
    const { property } = await chainWithProperty();
    const { token: mgrToken } = await actor('mgr4@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const { token: staffToken } = await actor('staff1@example.com', 'PROPERTY', property.id, 'OUTLET_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);

    await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ outletId: outletRes.body.id, name: 'GST 5%', ratePercent: '5.00' })
      .expect(403);

    const created = await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ outletId: outletRes.body.id, name: 'GST 5%', ratePercent: '5.00' })
      .expect(201);
    expect(created.body.name).toBe('GST 5%');
    expect(created.body.isActive).toBe(true);
  });

  it('AC: rejects a ratePercent outside 0-100', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr5@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);

    await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: outletRes.body.id, name: 'Bad Rate', ratePercent: '150.00' })
      .expect(400);
  });

  it('AC: PATCH /tax-rates/:id edits name/percentage without affecting anything else', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr6@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    const rates = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    const vat = rates.body.find((r: { name: string }) => r.name === 'VAT 15%');

    const updated = await api()
      .patch(`/api/v1/tax-rates/${vat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'VAT 15% (Updated)', ratePercent: '16.00' })
      .expect(200);
    expect(updated.body.name).toBe('VAT 15% (Updated)');
    expect(updated.body.ratePercent).toBe('16.00');
    expect(updated.body.isActive).toBe(true);
  });

  it('AC: DELETE /tax-rates/:id soft-deactivates (isActive: false), never hard-deletes', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr7@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    const rates = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    const vat = rates.body.find((r: { name: string }) => r.name === 'VAT 15%');

    const deactivated = await api()
      .delete(`/api/v1/tax-rates/${vat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deactivated.body.isActive).toBe(false);

    // Still exists in the DB — a real row, not gone.
    const stillExists = await prisma.taxRate.findUnique({ where: { id: vat.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists!.isActive).toBe(false);
  });

  it('AC: GET /tax-rates without isActive returns both; isActive=true returns only active rows', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr8@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    const rates = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    const vat = rates.body.find((r: { name: string }) => r.name === 'VAT 15%');
    await api().delete(`/api/v1/tax-rates/${vat.id}`).set('Authorization', `Bearer ${token}`).expect(200);

    const all = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body).toHaveLength(2);

    const onlyActive = await api()
      .get('/api/v1/tax-rates?isActive=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(onlyActive.body).toHaveLength(1);
    expect(onlyActive.body.some((r: { name: string }) => r.name === 'VAT 15%')).toBe(false);
  });

  it('AC: deactivating a tax rate does not alter an item that already references it as its default', async () => {
    const { property } = await chainWithProperty();
    const { token } = await actor('mgr9@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    const outletId = outletRes.body.id;
    const rates = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    const vat = rates.body.find((r: { name: string }) => r.name === 'VAT 15%');
    const cat = await prisma.category.findFirstOrThrow({ where: { outletId } });

    const item = await api()
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'Basmati Rice',
        categoryId: cat.id,
        sku: 'RICE-BAS-001',
        unit: 'KG',
        minStock: '10',
        maxStock: '100',
        costPrice: '85.50',
        defaultTaxRateId: vat.id,
      })
      .expect(201);

    await api().delete(`/api/v1/tax-rates/${vat.id}`).set('Authorization', `Bearer ${token}`).expect(200);

    const fetched = await api()
      .get(`/api/v1/items/${item.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Unaffected — still points at the same (now inactive) rate.
    expect(fetched.body.defaultTaxRateId).toBe(vat.id);
  });

  // ---------------------------------------------------------------------
  // Compound tax rates (CGST/SGST/IGST) and the calculation preview
  // ---------------------------------------------------------------------

  async function setupOutlet(email: string) {
    const { property } = await chainWithProperty();
    const { token } = await actor(email, 'PROPERTY', property.id, 'PROPERTY_MANAGER');
    const outletRes = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant', type: 'RESTAURANT' })
      .expect(201);
    return { token, outletId: outletRes.body.id };
  }

  it('AC: creates a compound GST rate with two components (CGST+SGST) summing to the overall rate', async () => {
    const { token, outletId } = await setupOutlet('compound1@example.com');

    const created = await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'GST 18% (Intra-state)',
        ratePercent: '18.00',
        isCompound: true,
        components: [
          { componentName: 'CGST', componentRate: '9.00' },
          { componentName: 'SGST', componentRate: '9.00' },
        ],
      })
      .expect(201);

    expect(created.body.isCompound).toBe(true);
    expect(created.body.components).toEqual([
      expect.objectContaining({ componentName: 'CGST', componentRate: '9.00' }),
      expect.objectContaining({ componentName: 'SGST', componentRate: '9.00' }),
    ]);
  });

  it('AC: rejects a compound rate whose components do not sum to the stated overall rate', async () => {
    const { token, outletId } = await setupOutlet('compound2@example.com');

    await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'Bad GST',
        ratePercent: '18.00',
        isCompound: true,
        components: [
          { componentName: 'CGST', componentRate: '8.00' },
          { componentName: 'SGST', componentRate: '9.00' },
        ],
      })
      .expect(400);
  });

  it('AC: preview computes an itemized CGST/SGST breakdown for a compound rate, not a single lumped figure', async () => {
    const { token, outletId } = await setupOutlet('preview1@example.com');

    const created = await api()
      .post('/api/v1/tax-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        name: 'GST 18% (Intra-state)',
        ratePercent: '18.00',
        isCompound: true,
        components: [
          { componentName: 'CGST', componentRate: '9.00' },
          { componentName: 'SGST', componentRate: '9.00' },
        ],
      })
      .expect(201);

    const preview = await api()
      .post(`/api/v1/tax-rates/${created.body.id}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subtotal: '200.00' })
      .expect(201);

    expect(preview.body.lineSubtotal).toBe('200.00');
    expect(preview.body.lineTaxAmount).toBe('36.00');
    expect(preview.body.lineTotal).toBe('236.00');
    expect(preview.body.components).toEqual([
      { componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' },
      { componentName: 'SGST', componentRate: '9.00', componentAmount: '18.00' },
    ]);
  });

  it('AC: preview computes a simple rate as a single lump figure with no components', async () => {
    const { token, outletId } = await setupOutlet('preview2@example.com');
    const rates = await api().get('/api/v1/tax-rates').set('Authorization', `Bearer ${token}`).expect(200);
    const vat = rates.body.find((r: { name: string }) => r.name === 'VAT 15%');

    const preview = await api()
      .post(`/api/v1/tax-rates/${vat.id}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subtotal: '100.00' })
      .expect(201);

    expect(preview.body.lineTaxAmount).toBe('15.00');
    expect(preview.body.lineTotal).toBe('115.00');
    expect(preview.body.components).toEqual([]);
  });
});
