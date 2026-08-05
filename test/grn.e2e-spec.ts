import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-04's GRN creation flows end-to-end: Direct (Flow 1) and
 * Against-a-PO (Flow 2) — Scan Invoice (Flow 3) is Stage 6, a separate
 * suite. Covers tax/currency/adjustment computation (shared with PO), the
 * variance-tolerance + approval gate, StockTransaction/SupplierPriceHistory
 * side effects, PO status recomputation, and FR-18 wiring.
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('GRN (FR-04) e2e', () => {
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
    await prisma.gRNLineTaxComponent.deleteMany();
    await prisma.gRNLine.deleteMany();
    await prisma.gRN.deleteMany();
    await prisma.supplierPriceHistory.deleteMany();
    // FR-07: a stock movement below minimum raises an Alert, whose itemId
    // is a real FK — so alerts clear before the items they point at.
    await prisma.alert.deleteMany();
    await prisma.stockTransaction.deleteMany();
    await prisma.pOLineTaxComponent.deleteMany();
    await prisma.pOLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.item.deleteMany();
    await prisma.category.deleteMany();
    await prisma.taxRateComponent.deleteMany();
    await prisma.taxRate.deleteMany();
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

  let skuCounter = 0;

  async function setupOutlet(baseCurrency = 'SAR') {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT', baseCurrency },
    });
    const supplier = await prisma.supplier.create({
      data: { outletId: outlet.id, name: 'Al-Fahad Trading', email: 'supplier@example.com' },
    });
    const taxRate = await prisma.taxRate.create({
      data: { outletId: outlet.id, name: 'VAT 15%', ratePercent: '15.00', countryCode: 'SA' },
    });
    const category = await prisma.category.create({ data: { name: 'Dry Goods', outletId: outlet.id } });
    const unit = await prisma.unitOfMeasure.create({ data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id } });
    const item = await prisma.item.create({
      data: {
        outletId: outlet.id,
        categoryId: category.id,
        unitId: unit.id,
        name: 'Basmati Rice',
        sku: `RICE-BAS-${String(++skuCounter).padStart(3, '0')}`,
        minStock: '10',
        maxStock: '1000',
        costPrice: '85.50',
        currentStock: '10',
      },
    });
    return { outletId: outlet.id, supplierId: supplier.id, taxRateId: taxRate.id, itemId: item.id };
  }

  async function createAndApprovePo(token: string, outletId: string, supplierId: string, itemId: string, orderedQty: string) {
    const created = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, supplierId, lines: [{ itemId, orderedQty, expectedPrice: '87.00' }] })
      .expect(201);
    const id = created.body.id as string;
    await api().patch(`/api/v1/purchase-orders/${id}/submit`).set('Authorization', `Bearer ${token}`).expect(200);
    await api().patch(`/api/v1/purchase-orders/${id}/approve`).set('Authorization', `Bearer ${token}`).expect(200);
    return id;
  }

  describe('Direct GRN (Flow 1)', () => {
    it('AC: a GRN can be created with no linked PO, supplier chosen directly', async () => {
      const { outletId, supplierId, taxRateId, itemId } = await setupOutlet();
      const { token } = await actor('owner1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const res = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          lines: [{ itemId, receivedQty: '5', actualPrice: '92.00', taxRateId }],
        })
        .expect(201);

      expect(res.body.purchaseOrderId).toBeNull();
      expect(res.body.subtotal).toBe('460.00');
      expect(res.body.taxAmount).toBe('69.00');
      expect(res.body.totalValue).toBe('529.00');
    });

    it('AC: a GRN cannot be saved without a supplier, enforced server-side', async () => {
      const { outletId, itemId } = await setupOutlet();
      const { token } = await actor('owner2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(400);
    });

    it('AC: a line with no taxRateId is untaxed (never an error); an invalid one is rejected with 400', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner3@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const untaxed = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);
      expect(untaxed.body.taxAmount).toBe('0.00');

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          lines: [{ itemId, receivedQty: '5', actualPrice: '92.00', taxRateId: 'nonexistent' }],
        })
        .expect(400);
    });

    it('AC: every finalized GRN line results in exactly one StockTransaction and one SupplierPriceHistory row', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner4@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);

      const stockTxs = await prisma.stockTransaction.findMany({ where: { itemId } });
      expect(stockTxs).toHaveLength(1);
      expect(stockTxs[0]?.type).toBe('PURCHASE_IN');

      const priceHistory = await prisma.supplierPriceHistory.findMany({ where: { itemId, supplierId } });
      expect(priceHistory).toHaveLength(1);
      expect(priceHistory[0]?.source).toBe('GRN');
      expect(priceHistory[0]?.price.toFixed(2)).toBe('92.00');
      expect(priceHistory[0]?.priceInBaseCurrency?.toFixed(2)).toBe('92.00');
    });

    it('AC: SupplierPriceHistory.priceInBaseCurrency keeps prices comparable across suppliers billing in different currencies', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet('SAR');
      const { token } = await actor('owner4b@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          currencyCode: 'EUR',
          exchangeRateToBase: '3.75',
          lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }],
        })
        .expect(201);

      const priceHistory = await prisma.supplierPriceHistory.findMany({ where: { itemId, supplierId } });
      expect(priceHistory).toHaveLength(1);
      expect(priceHistory[0]?.currencyCode).toBe('EUR');
      expect(priceHistory[0]?.price.toFixed(2)).toBe('92.00');
      // 92.00 EUR * 3.75 = 345.00 in the outlet's SAR base currency — the
      // figure that makes this comparable against a SAR-billing supplier.
      expect(priceHistory[0]?.priceInBaseCurrency?.toFixed(2)).toBe('345.00');
    });

    it('increases Item.currentStock by the received quantity', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner5@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);

      const updated = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
      expect(updated.currentStock.toFixed(3)).toBe('15.000'); // 10 + 5
    });

    it('AC: an Other Charges amount is included in totalValue', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner6@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const res = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          otherChargesAmount: '25.00',
          lines: [{ itemId, receivedQty: '5', actualPrice: '10.00' }],
        })
        .expect(201);
      expect(res.body.subtotal).toBe('50.00');
      expect(res.body.totalValue).toBe('75.00');
    });

    it('AC: a Discount amount reduces totalValue', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner6b@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const res = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          discountAmount: '10.00',
          lines: [{ itemId, receivedQty: '5', actualPrice: '10.00' }],
        })
        .expect(201);
      expect(res.body.subtotal).toBe('50.00');
      expect(res.body.totalValue).toBe('40.00');
    });

    it('AC: setting Tax Inclusive correctly reverse-calculates lineSubtotal/lineTaxAmount', async () => {
      const { outletId, supplierId, taxRateId, itemId } = await setupOutlet();
      const { token } = await actor('owner7@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const res = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          isTaxInclusive: true,
          lines: [{ itemId, receivedQty: '1', actualPrice: '115.00', taxRateId }],
        })
        .expect(201);
      expect(res.body.lines[0].lineTotal).toBe('115.00');
      expect(res.body.lines[0].lineSubtotal).toBe('100.00');
      expect(res.body.lines[0].lineTaxAmount).toBe('15.00');
    });

    describe('RBAC', () => {
      it('AC: STORE_STAFF can create a Direct GRN', async () => {
        const { outletId, supplierId, itemId } = await setupOutlet();
        const { token } = await actor('staff1@example.com', 'OUTLET', outletId, 'STORE_STAFF');
        await api()
          .post('/api/v1/grn/direct')
          .set('Authorization', `Bearer ${token}`)
          .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
          .expect(201);
      });

      it('rejects CHEF from creating a GRN', async () => {
        const { outletId, supplierId, itemId } = await setupOutlet();
        const { token } = await actor('chef1@example.com', 'OUTLET', outletId, 'CHEF');
        await api()
          .post('/api/v1/grn/direct')
          .set('Authorization', `Bearer ${token}`)
          .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
          .expect(403);
      });
    });
  });

  describe('Against a PO (Flow 2)', () => {
    it('AC: selecting a PO auto-populates lines; the user can accept the PO defaults as-is', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner8@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const poId = await createAndApprovePo(token, outletId, supplierId, itemId, '20');
      await api().patch(`/api/v1/purchase-orders/${poId}/send`).set('Authorization', `Bearer ${token}`).expect(200);

      const res = await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '20', actualPrice: '87.00' }] })
        .expect(201);

      expect(res.body.purchaseOrderId).toBe(poId);
      expect(res.body.varianceFlagged).toBe(false);
    });

    it('AC: GRN receipt beyond the ordered quantity is rejected at the API level', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner9@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const poId = await createAndApprovePo(token, outletId, supplierId, itemId, '20');
      await api().patch(`/api/v1/purchase-orders/${poId}/send`).set('Authorization', `Bearer ${token}`).expect(200);

      await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '25', actualPrice: '87.00' }] })
        .expect(400);
    });

    it('AC: variance beyond tolerance blocks STORE_STAFF from finalizing (403), but not OUTLET_MANAGER', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const owner = await actor('owner10@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const poId = await createAndApprovePo(owner.token, outletId, supplierId, itemId, '20');
      await api().patch(`/api/v1/purchase-orders/${poId}/send`).set('Authorization', `Bearer ${owner.token}`).expect(200);

      const staff = await actor('staff3@example.com', 'OUTLET', outletId, 'STORE_STAFF');
      // Ordered 20, received 10 -> 50% variance, beyond the 10% default tolerance.
      await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ lines: [{ itemId, receivedQty: '10', actualPrice: '87.00' }] })
        .expect(403);

      const res = await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ lines: [{ itemId, receivedQty: '10', actualPrice: '87.00' }] })
        .expect(201);
      expect(res.body.varianceFlagged).toBe(true);
    });

    it('AC: recomputes PO status to PARTIALLY_RECEIVED then FULLY_RECEIVED as GRNs are finalized', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner11@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const poId = await createAndApprovePo(token, outletId, supplierId, itemId, '20');
      await api().patch(`/api/v1/purchase-orders/${poId}/send`).set('Authorization', `Bearer ${token}`).expect(200);

      // Within-tolerance partial receipt (18/20 = 10% variance, at the edge
      // but not beyond it) — no approval gate should trigger.
      await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '18', actualPrice: '87.00' }] })
        .expect(201);

      let po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(po.status).toBe('PARTIALLY_RECEIVED');

      await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '2', actualPrice: '87.00' }] })
        .expect(201);

      po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(po.status).toBe('FULLY_RECEIVED');

      const poLine = await prisma.pOLine.findFirstOrThrow({ where: { purchaseOrderId: poId } });
      expect(poLine.receivedQty.toFixed(3)).toBe('20.000');
    });

    it('rejects receiving against a PO that is still DRAFT', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('owner12@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const created = await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, orderedQty: '20', expectedPrice: '87.00' }] })
        .expect(201);

      await api()
        .post(`/api/v1/purchase-orders/${created.body.id}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '20', actualPrice: '87.00' }] })
        .expect(409);
    });
  });

  describe('FR-18 wiring', () => {
    it('produces an ActivityLog and TransactionLog entry for Direct GRN creation', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token, userId } = await actor('audit1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const created = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);

      const activity = await prisma.activityLog.findFirst({
        where: { action: 'CREATE_GRN_DIRECT', entityId: created.body.id },
      });
      expect(activity).not.toBeNull();
      expect(activity?.userId).toBe(userId);

      const txLog = await prisma.transactionLog.findMany({ where: { entityId: created.body.id } });
      expect(txLog.length).toBeGreaterThan(0);
    });

    it('produces an ActivityLog entry for Against-PO GRN creation', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('audit2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const poId = await createAndApprovePo(token, outletId, supplierId, itemId, '20');
      await api().patch(`/api/v1/purchase-orders/${poId}/send`).set('Authorization', `Bearer ${token}`).expect(200);

      const created = await api()
        .post(`/api/v1/purchase-orders/${poId}/grn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ itemId, receivedQty: '20', actualPrice: '87.00' }] })
        .expect(201);

      const activity = await prisma.activityLog.findFirst({
        where: { action: 'CREATE_GRN_AGAINST_PO', entityId: created.body.id },
      });
      expect(activity).not.toBeNull();
    });
  });

  describe('Print & Email', () => {
    it('AC: GET /grn/:id/pdf produces a real, formatted PDF document', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token } = await actor('pdf1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const created = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);

      const res = await api().get(`/api/v1/grn/${created.body.id}/pdf`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('AC: emailing defaults the recipient to the supplier email on file and records the send', async () => {
      const { outletId, supplierId, itemId } = await setupOutlet();
      const { token, userId } = await actor('email1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const created = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId, receivedQty: '5', actualPrice: '92.00' }] })
        .expect(201);

      const res = await api()
        .post(`/api/v1/grn/${created.body.id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      expect(res.body.lastEmailedTo).toBe('supplier@example.com');
      expect(res.body.lastEmailedAt).toBeTruthy();

      const activity = await prisma.activityLog.findFirst({
        where: { action: 'EMAIL_GRN', entityId: created.body.id },
      });
      expect(activity).not.toBeNull();
      expect(activity?.userId).toBe(userId);
    });

    it('AC: rejects emailing with no valid recipient (none on file, none provided)', async () => {
      const chain = await prisma.chain.create({ data: { name: 'No-Email Group' } });
      const property = await prisma.property.create({ data: { chainId: chain.id, name: 'Property', type: 'HOTEL' } });
      const outlet = await prisma.outlet.create({
        data: { propertyId: property.id, chainId: chain.id, name: 'Outlet', type: 'RESTAURANT' },
      });
      const supplier = await prisma.supplier.create({ data: { outletId: outlet.id, name: 'No Email Supplier' } });
      const category = await prisma.category.create({ data: { name: 'Dry Goods', outletId: outlet.id } });
      const unit = await prisma.unitOfMeasure.create({ data: { name: 'Kilogram', abbreviation: 'kg', outletId: outlet.id } });
      const item = await prisma.item.create({
        data: {
          outletId: outlet.id,
          categoryId: category.id,
          unitId: unit.id,
          name: 'Basmati Rice',
          sku: 'RICE-NOEMAIL-001',
          minStock: '10',
          maxStock: '1000',
          costPrice: '85.50',
          currentStock: '0',
        },
      });
      const { token } = await actor('email2@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const created = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId: outlet.id, supplierId: supplier.id, lines: [{ itemId: item.id, receivedQty: '1', actualPrice: '1.00' }] })
        .expect(201);

      await api()
        .post(`/api/v1/grn/${created.body.id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });
  });

  it('returns 401 for a request with no bearer token at all', async () => {
    const { outletId } = await setupOutlet();
    await api().get(`/api/v1/grn?outletId=${outletId}`).expect(401);
  });
});
