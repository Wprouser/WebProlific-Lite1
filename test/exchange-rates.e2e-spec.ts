import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * FR-16: ExchangeRate is global/platform-wide (no outletId) — created via a
 * flat @Roles() check (CHAIN_OWNER/PROPERTY_MANAGER), not @ResourceScope,
 * since there's no single outlet resource to scope against. Requires:
 * docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Exchange Rates (FR-16) e2e', () => {
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
    await prisma.exchangeRate.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.user.deleteMany();
  });

  const api = () => request(app.getHttpServer());

  async function actor(role: string, email: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    // A scope id that doesn't need to resolve to anything real — the
    // create endpoint checks the flat effectiveRole, not a per-resource
    // grant, so any CHAIN-scoped grant is enough to set that role.
    await prisma.userAccess.create({
      data: { userId: user.id, scopeType: 'CHAIN', scopeId: 'irrelevant-chain', role },
    });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  it('returns 401 with no bearer token at all', async () => {
    await api().get('/api/v1/exchange-rates').expect(401);
  });

  it('AC: any authenticated user (even with no role grants at all) can read the list', async () => {
    const user = await prisma.user.create({
      data: { email: 'reader@example.com', passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    const token = tokenService.signAccessToken(user.id);
    await api().get('/api/v1/exchange-rates').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('AC: PROPERTY_MANAGER/CHAIN_OWNER can record a new manual rate', async () => {
    const { token } = await actor('PROPERTY_MANAGER', 'pm@example.com');
    const res = await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'USD', rate: '0.266667' })
      .expect(201);

    expect(res.body).toMatchObject({
      baseCurrency: 'SAR',
      targetCurrency: 'USD',
      rate: '0.266667',
      source: 'MANUAL',
    });
  });

  it('AC: rejects OUTLET_MANAGER attempting to record a rate', async () => {
    const { token } = await actor('OUTLET_MANAGER', 'om@example.com');
    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'USD', rate: '0.266667' })
      .expect(403);
  });

  it('rejects a pair with an unknown currency code', async () => {
    const { token } = await actor('CHAIN_OWNER', 'owner@example.com');
    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'ZZZ', rate: '1.000000' })
      .expect(404);
  });

  it('rejects base === target', async () => {
    const { token } = await actor('CHAIN_OWNER', 'owner2@example.com');
    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'SAR', rate: '1.000000' })
      .expect(400);
  });

  it('AC: the system always uses the latest rate — a newer effectiveDate row wins over an older one for the same pair', async () => {
    const { token } = await actor('CHAIN_OWNER', 'owner3@example.com');

    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'EUR', rate: '0.250000' })
      .expect(201);

    // A tiny delay so the second row's effectiveDate (defaulted server-side
    // to now()) is unambiguously later than the first's.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'EUR', rate: '0.240000' })
      .expect(201);

    const list = await api()
      .get('/api/v1/exchange-rates?base=SAR&target=EUR')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(second.body.id);
    expect(list.body[0].rate).toBe('0.240000');

    // Both rows still exist (append-only, never edited in place).
    const allRows = await prisma.exchangeRate.findMany({ where: { baseCurrency: 'SAR', targetCurrency: 'EUR' } });
    expect(allRows).toHaveLength(2);
  });

  it('AC: filtering by base alone returns the latest rate per target currency for that base', async () => {
    const { token } = await actor('CHAIN_OWNER', 'owner4@example.com');
    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'USD', rate: '0.266667' })
      .expect(201);
    await api()
      .post('/api/v1/exchange-rates')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'SAR', targetCurrency: 'GBP', rate: '0.210000' })
      .expect(201);

    const res = await api()
      .get('/api/v1/exchange-rates?base=SAR')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const targets = res.body.map((r: { targetCurrency: string }) => r.targetCurrency).sort();
    expect(targets).toEqual(['GBP', 'USD']);
  });
});
