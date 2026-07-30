import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Exercises FR-04's GRN Flow 3 (AI-04 Scan Invoice) end-to-end: upload
 * (multipart), the async PROCESSING -> EXTRACTED contract, and confirming
 * a reviewed scan into a real GRN via the existing POST /grn/direct (the
 * scan session itself never auto-creates a GRN — see InvoiceScan's schema
 * comment for why this is a separate resource from GRN).
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Invoice Scans (FR-04 / AI-04) e2e', () => {
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
    await prisma.stockTransaction.deleteMany();
    await prisma.invoiceScan.deleteMany();
    await prisma.supplier.deleteMany();
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

  async function setupOutlet() {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' },
    });
    const supplier = await prisma.supplier.create({
      data: { outletId: outlet.id, name: 'Al-Fahad Trading' },
    });
    return { outletId: outlet.id, supplierId: supplier.id };
  }

  async function pollUntilExtracted(token: string, id: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await api().get(`/api/v1/invoice-scans/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
      if (res.body.status !== 'PROCESSING') return res;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Invoice scan never left PROCESSING status');
  }

  it('AC: upload returns 202-style immediate response with scanStatus PROCESSING', async () => {
    const { outletId } = await setupOutlet();
    const { token } = await actor('owner1@example.com', outletId, 'OUTLET_MANAGER');

    const res = await api()
      .post('/api/v1/invoice-scans')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', outletId)
      .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body.status).toBe('PROCESSING');
    expect(res.body.outletId).toBe(outletId);
  });

  it('AC: extraction pre-fills the review data but never auto-submits a GRN', async () => {
    const { outletId } = await setupOutlet();
    const { token } = await actor('owner2@example.com', outletId, 'OUTLET_MANAGER');

    const uploaded = await api()
      .post('/api/v1/invoice-scans')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', outletId)
      .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const extracted = await pollUntilExtracted(token, uploaded.body.id);
    expect(extracted.body.status).toBe('EXTRACTED');
    expect(extracted.body.extractedData.lines.length).toBeGreaterThan(0);

    // No GRN was created just from uploading/extracting.
    const grns = await prisma.gRN.findMany({ where: { outletId } });
    expect(grns).toHaveLength(0);
  });

  it('rejects an unsupported file type', async () => {
    const { outletId } = await setupOutlet();
    const { token } = await actor('owner3@example.com', outletId, 'OUTLET_MANAGER');

    await api()
      .post('/api/v1/invoice-scans')
      .set('Authorization', `Bearer ${token}`)
      .field('outletId', outletId)
      .attach('file', Buffer.from('not an invoice'), { filename: 'malware.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  describe('RBAC', () => {
    it('AC: STORE_STAFF can upload an invoice scan', async () => {
      const { outletId } = await setupOutlet();
      const { token } = await actor('staff1@example.com', outletId, 'STORE_STAFF');
      await api()
        .post('/api/v1/invoice-scans')
        .set('Authorization', `Bearer ${token}`)
        .field('outletId', outletId)
        .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(201);
    });

    it('rejects CHEF from uploading a scan', async () => {
      const { outletId } = await setupOutlet();
      const { token } = await actor('chef1@example.com', outletId, 'CHEF');
      await api()
        .post('/api/v1/invoice-scans')
        .set('Authorization', `Bearer ${token}`)
        .field('outletId', outletId)
        .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(403);
    });
  });

  describe('confirming a scan into a real GRN', () => {
    it('AC: the reviewed/edited data is submitted via the existing POST /grn/direct, which attaches the scan file url', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const category = await prisma.category.create({ data: { name: 'Dry Goods', outletId } });
      const unit = await prisma.unitOfMeasure.create({ data: { name: 'Kilogram', abbreviation: 'kg', outletId } });
      const item = await prisma.item.create({
        data: {
          outletId,
          categoryId: category.id,
          unitId: unit.id,
          name: 'Basmati Rice',
          sku: 'RICE-SCAN-001',
          minStock: '10',
          maxStock: '1000',
          costPrice: '85.50',
          currentStock: '0',
        },
      });
      const { token } = await actor('owner4@example.com', outletId, 'OUTLET_MANAGER');

      const uploaded = await api()
        .post('/api/v1/invoice-scans')
        .set('Authorization', `Bearer ${token}`)
        .field('outletId', outletId)
        .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await pollUntilExtracted(token, uploaded.body.id);

      // Human reviews/corrects the extraction (the stub's unmatched line),
      // then confirms with the real item and supplier.
      const grn = await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          invoiceScanId: uploaded.body.id,
          lines: [{ itemId: item.id, receivedQty: '20', actualPrice: '87.00' }],
        })
        .expect(201);

      expect(grn.body.invoiceScanStatus).toBe('EXTRACTED');
      expect(grn.body.invoiceScanUrl).toContain('/uploads/invoice-scans/');
    });

    it('rejects an invoiceScanId that belongs to a different outlet', async () => {
      const { outletId, supplierId } = await setupOutlet();
      const { outletId: otherOutletId } = await setupOutlet();
      const { token } = await actor('owner5@example.com', outletId, 'OUTLET_MANAGER');
      const otherOwner = await actor('owner6@example.com', otherOutletId, 'OUTLET_MANAGER');

      const uploaded = await api()
        .post('/api/v1/invoice-scans')
        .set('Authorization', `Bearer ${otherOwner.token}`)
        .field('outletId', otherOutletId)
        .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(201);

      await api()
        .post('/api/v1/grn/direct')
        .set('Authorization', `Bearer ${token}`)
        .send({
          outletId,
          supplierId,
          invoiceScanId: uploaded.body.id,
          lines: [{ itemId: 'irrelevant', receivedQty: '1', actualPrice: '1.00' }],
        })
        .expect(400);
    });
  });

  describe('FR-18 wiring', () => {
    it('produces an ActivityLog entry for the upload', async () => {
      const { outletId } = await setupOutlet();
      const { token, userId } = await actor('audit1@example.com', outletId, 'OUTLET_MANAGER');

      const uploaded = await api()
        .post('/api/v1/invoice-scans')
        .set('Authorization', `Bearer ${token}`)
        .field('outletId', outletId)
        .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(201);

      const activity = await prisma.activityLog.findFirst({
        where: { action: 'CREATE_INVOICE_SCAN', entityId: uploaded.body.id },
      });
      expect(activity).not.toBeNull();
      expect(activity?.userId).toBe(userId);
    });
  });

  it('returns 401 for a request with no bearer token at all', async () => {
    const { outletId } = await setupOutlet();
    await api()
      .post('/api/v1/invoice-scans')
      .field('outletId', outletId)
      .attach('file', Buffer.from('fake-invoice-bytes'), { filename: 'invoice.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });
});
