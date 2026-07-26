import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-04's Purchase Order lifecycle end-to-end: create (tax +
 * currency + adjustment computation), submit/approve/reject/send/close
 * transitions, threshold-gated approval RBAC, and FR-18 Activity/
 * Transaction Log wiring. GRN (also FR-04) is a separate suite (Stage 4).
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Purchase Orders (FR-04) e2e', () => {
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
    await prisma.pOLineTaxComponent.deleteMany();
    await prisma.pOLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
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

  async function setupOutlet(baseCurrency = 'SAR', poApprovalThreshold: string | null = null) {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: {
        propertyId: property.id,
        chainId: chain.id,
        name: 'Main Restaurant',
        type: 'RESTAURANT',
        baseCurrency,
        poApprovalThreshold: poApprovalThreshold ?? undefined,
      },
    });
    const supplier = await prisma.supplier.create({
      data: { outletId: outlet.id, name: 'Al-Fahad Trading', email: 'supplier@example.com' },
    });
    const taxRate = await prisma.taxRate.create({
      data: { outletId: outlet.id, name: 'VAT 15%', ratePercent: '15.00', countryCode: 'SA' },
    });
    return { chain, property, outletId: outlet.id, supplierId: supplier.id, taxRateId: taxRate.id };
  }

  it('AC: computes line/document totals correctly (tax + currency), and Tax amounts are always server-computed', async () => {
    const { outletId, supplierId, taxRateId } = await setupOutlet();
    const { token } = await actor('owner@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        lines: [{ itemId: 'item-1', orderedQty: '20', expectedPrice: '87.00', taxRateId }],
      })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.currencyCode).toBe('SAR');
    expect(res.body.subtotal).toBe('1740.00');
    expect(res.body.taxAmount).toBe('261.00');
    expect(res.body.totalValue).toBe('2001.00');
    expect(res.body.lines[0].taxRate).toBe('15.00');
  });

  it('AC: a line with no taxRateId is untaxed (never an error); an invalid one is rejected with 400', async () => {
    const { outletId, supplierId } = await setupOutlet();
    const { token } = await actor('owner2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

    const untaxed = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '5', expectedPrice: '10.00' }] })
      .expect(201);
    expect(untaxed.body.taxAmount).toBe('0.00');

    await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        lines: [{ itemId: 'item-1', orderedQty: '5', expectedPrice: '10.00', taxRateId: 'nonexistent' }],
      })
      .expect(400);
  });

  it('AC: an Other Charges amount is included in totalValue and shown as its own line', async () => {
    const { outletId, supplierId } = await setupOutlet();
    const { token } = await actor('owner3@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        otherChargesAmount: '25.00',
        lines: [{ itemId: 'item-1', orderedQty: '5', expectedPrice: '10.00' }],
      })
      .expect(201);
    expect(res.body.subtotal).toBe('50.00');
    expect(res.body.totalValue).toBe('75.00');
  });

  it('AC: a Discount amount reduces totalValue and is shown as its own line', async () => {
    const { outletId, supplierId } = await setupOutlet();
    const { token } = await actor('owner3b@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        discountAmount: '10.00',
        lines: [{ itemId: 'item-1', orderedQty: '5', expectedPrice: '10.00' }],
      })
      .expect(201);
    expect(res.body.subtotal).toBe('50.00');
    expect(res.body.totalValue).toBe('40.00');
  });

  it('AC: setting Tax Inclusive correctly reverse-calculates lineSubtotal/lineTaxAmount', async () => {
    const { outletId, supplierId, taxRateId } = await setupOutlet();
    const { token } = await actor('owner4@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        isTaxInclusive: true,
        lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '115.00', taxRateId }],
      })
      .expect(201);
    expect(res.body.lines[0].lineTotal).toBe('115.00');
    expect(res.body.lines[0].lineSubtotal).toBe('100.00');
    expect(res.body.lines[0].lineTaxAmount).toBe('15.00');
  });

  it('AC: a PO raised in a foreign currency snapshots exchangeRateToBase from the latest ExchangeRate row', async () => {
    const { outletId, supplierId } = await setupOutlet('SAR');
    const { token } = await actor('owner5@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
    await prisma.exchangeRate.create({
      data: { baseCurrency: 'USD', targetCurrency: 'SAR', rate: '3.750000', source: 'MANUAL' },
    });

    const res = await api()
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        supplierId,
        currencyCode: 'USD',
        lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '100.00' }],
      })
      .expect(201);
    expect(res.body.exchangeRateToBase).toBe('3.750000');
  });

  describe('RBAC', () => {
    it('AC: STORE_STAFF can create a PO', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('staff@example.com', 'OUTLET', outletId, 'STORE_STAFF');
      await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '10.00' }] })
        .expect(201);
    });

    it('rejects CHEF from creating a PO', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('chef@example.com', 'OUTLET', outletId, 'CHEF');
      await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '10.00' }] })
        .expect(403);
    });
  });

  describe('lifecycle', () => {
    async function createDraftPO(token: string, outletId: string, supplierId: string) {
      const res = await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '10.00' }] })
        .expect(201);
      return res.body.id as string;
    }

    it('AC: DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT_TO_SUPPLIER', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('lifecycle1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const submitted = await api()
        .patch(`/api/v1/purchase-orders/${id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(submitted.body.status).toBe('PENDING_APPROVAL');

      const approved = await api()
        .patch(`/api/v1/purchase-orders/${id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedById).toBeTruthy();

      const sent = await api()
        .patch(`/api/v1/purchase-orders/${id}/send`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(sent.body.status).toBe('SENT_TO_SUPPLIER');
    });

    it('AC: reject requires a reason and moves PO to REJECTED', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('lifecycle2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);
      await api().patch(`/api/v1/purchase-orders/${id}/submit`).set('Authorization', `Bearer ${token}`).expect(200);

      await api()
        .patch(`/api/v1/purchase-orders/${id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400); // reason is required

      const rejected = await api()
        .patch(`/api/v1/purchase-orders/${id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Price too high' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');
    });

    it('rejects a status transition attempted out of order (e.g. approving a DRAFT PO)', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('lifecycle3@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);
      await api().patch(`/api/v1/purchase-orders/${id}/approve`).set('Authorization', `Bearer ${token}`).expect(409);
    });

    it('AC: PARTIALLY_RECEIVED -> CLOSED by OUTLET_MANAGER', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('lifecycle4@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);
      // PARTIALLY_RECEIVED is normally reached via GRN finalization
      // (Stage 4, not built yet in this suite) — set the precondition
      // directly to exercise the close transition itself.
      await prisma.purchaseOrder.update({ where: { id }, data: { status: 'PARTIALLY_RECEIVED' } });

      const closed = await api()
        .patch(`/api/v1/purchase-orders/${id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(closed.body.status).toBe('CLOSED');
    });

    it('a DRAFT PO can be edited; once submitted it can no longer be edited', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('lifecycle5@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const edited = await api()
        .patch(`/api/v1/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ otherChargesAmount: '5.00' })
        .expect(200);
      expect(edited.body.totalValue).toBe('15.00');

      await api().patch(`/api/v1/purchase-orders/${id}/submit`).set('Authorization', `Bearer ${token}`).expect(200);
      await api()
        .patch(`/api/v1/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ otherChargesAmount: '10.00' })
        .expect(409);
    });
  });

  describe('approval threshold (FR-11 permission matrix)', () => {
    async function createPendingPO(token: string, outletId: string, supplierId: string, totalPrice: string) {
      const res = await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: totalPrice }] })
        .expect(201);
      await api()
        .patch(`/api/v1/purchase-orders/${res.body.id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body.id as string;
    }

    it('AC: a STORE_STAFF cannot approve a PO regardless of value', async () => {
      const { outletId, supplierId } = await setupOutlet('SAR', '5000.00');
      const owner = await actor('approver1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createPendingPO(owner.token, outletId, supplierId, '1.00');
      const staff = await actor('staff2@example.com', 'OUTLET', outletId, 'STORE_STAFF');
      await api().patch(`/api/v1/purchase-orders/${id}/approve`).set('Authorization', `Bearer ${staff.token}`).expect(403);
    });

    it('AC: OUTLET_MANAGER/PROPERTY_MANAGER are blocked at or above the threshold; CHAIN_OWNER is never blocked', async () => {
      const { outletId, supplierId } = await setupOutlet('SAR', '500.00');
      const manager = await actor('approver2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const highValueId = await createPendingPO(manager.token, outletId, supplierId, '600.00');

      await api()
        .patch(`/api/v1/purchase-orders/${highValueId}/approve`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(403);

      const owner = await actor('chainowner@example.com', 'OUTLET', outletId, 'CHAIN_OWNER');
      const approved = await api()
        .patch(`/api/v1/purchase-orders/${highValueId}/approve`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
    });

    it('OUTLET_MANAGER can approve when below the threshold', async () => {
      const { outletId, supplierId } = await setupOutlet('SAR', '500.00');
      const manager = await actor('approver3@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createPendingPO(manager.token, outletId, supplierId, '100.00');
      await api()
        .patch(`/api/v1/purchase-orders/${id}/approve`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);
    });
  });

  describe('FR-18 wiring', () => {
    it('produces an ActivityLog and TransactionLog entry for create, and for a status transition', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token, userId } = await actor('audit1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');

      const created = await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '10.00' }] })
        .expect(201);

      const createActivity = await prisma.activityLog.findFirst({
        where: { action: 'CREATE_PURCHASE_ORDER', entityId: created.body.id },
      });
      expect(createActivity).not.toBeNull();
      expect(createActivity?.userId).toBe(userId);

      const createTxLog = await prisma.transactionLog.findMany({ where: { entityId: created.body.id } });
      expect(createTxLog.length).toBeGreaterThan(0);

      await api()
        .patch(`/api/v1/purchase-orders/${created.body.id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const submitActivity = await prisma.activityLog.findFirst({
        where: { action: 'SUBMIT_PURCHASE_ORDER', entityId: created.body.id },
      });
      expect(submitActivity).not.toBeNull();

      const submitTxLog = await prisma.transactionLog.findMany({
        where: { entityId: created.body.id, fieldName: 'status' },
      });
      expect(submitTxLog.length).toBeGreaterThan(0);
      expect(submitTxLog[0]?.newValue).toBe('PENDING_APPROVAL');
    });
  });

  describe('Print & Email', () => {
    async function createDraftPO(token: string, outletId: string, supplierId: string) {
      const res = await api()
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ outletId, supplierId, lines: [{ itemId: 'item-1', orderedQty: '1', expectedPrice: '10.00' }] })
        .expect(201);
      return res.body.id as string;
    }

    it('AC: GET /purchase-orders/:id/pdf produces a real, formatted PDF document', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('pdf1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const res = await api().get(`/api/v1/purchase-orders/${id}/pdf`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('AC: emailing defaults the recipient to the supplier email on file', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('email1@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const res = await api()
        .post(`/api/v1/purchase-orders/${id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      expect(res.body.lastEmailedTo).toBe('supplier@example.com');
      expect(res.body.lastEmailedAt).toBeTruthy();
    });

    it('AC: an explicit toEmail overrides the supplier default', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('email2@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const res = await api()
        .post(`/api/v1/purchase-orders/${id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({ toEmail: 'override@example.com' })
        .expect(201);
      expect(res.body.lastEmailedTo).toBe('override@example.com');
    });

    it('AC: rejects emailing with no valid recipient (none on file, none provided)', async () => {
      const chain = await prisma.chain.create({ data: { name: 'No-Email Group' } });
      const property = await prisma.property.create({ data: { chainId: chain.id, name: 'Property', type: 'HOTEL' } });
      const outlet = await prisma.outlet.create({
        data: { propertyId: property.id, chainId: chain.id, name: 'Outlet', type: 'RESTAURANT' },
      });
      const supplier = await prisma.supplier.create({ data: { outletId: outlet.id, name: 'No Email Supplier' } });
      const { token } = await actor('email3@example.com', 'OUTLET', outlet.id, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outlet.id, supplier.id);

      await api()
        .post(`/api/v1/purchase-orders/${id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('AC: emailing is available regardless of PO status (e.g. still DRAFT)', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token } = await actor('email4@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
      expect(po.status).toBe('DRAFT');

      await api()
        .post(`/api/v1/purchase-orders/${id}/send-email`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
    });

    it('AC: a successful send is recorded and produces an ActivityLog entry', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { token, userId } = await actor('email5@example.com', 'OUTLET', outletId, 'OUTLET_MANAGER');
      const id = await createDraftPO(token, outletId, supplierId);

      await api().post(`/api/v1/purchase-orders/${id}/send-email`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

      const activity = await prisma.activityLog.findFirst({ where: { action: 'EMAIL_PURCHASE_ORDER', entityId: id } });
      expect(activity).not.toBeNull();
      expect(activity?.userId).toBe(userId);

      const detail = await api().get(`/api/v1/purchase-orders/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(detail.body.lastEmailedTo).toBe('supplier@example.com');
    });
  });

  it('returns 401 for a request with no bearer token at all', async () => {
    const { outletId } = await setupOutlet();
    await api().get(`/api/v1/purchase-orders?outletId=${outletId}`).expect(401);
  });
});
