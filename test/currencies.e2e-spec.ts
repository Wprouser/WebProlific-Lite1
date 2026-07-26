import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * FR-16: Currency is global/platform-wide reference data, seeded once at
 * boot (CurrencySeedService) — not per-outlet, not deleted between tests
 * here (unlike tenant data), since it represents the same "already seeded
 * in production" state a real deployment would have.
 * Requires: docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Currencies (FR-16) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    tokenService = app.get(TokenService);

    // GET /currencies requires authentication (any role) but no specific
    // role beyond that — same as GET /tax-rates. One shared user for every
    // read-only test in this file.
    const user = await prisma.user.create({
      data: { email: 'reader@example.com', passwordHash: await passwordService.hash('Passw0rd!123') },
    });
    token = tokenService.signAccessToken(user.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('returns 401 with no bearer token at all', async () => {
    await api().get('/api/v1/currencies').expect(401);
  });

  it('AC: any authenticated user (no specific role required) can read the starter set', async () => {
    const res = await api().get('/api/v1/currencies').set('Authorization', `Bearer ${token}`).expect(200);
    const codes = res.body.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['SAR', 'AED', 'USD', 'INR', 'EUR', 'GBP']));
  });

  it('AC: each starter currency has the correct symbol and decimal places', async () => {
    const res = await api().get('/api/v1/currencies').set('Authorization', `Bearer ${token}`).expect(200);
    const byCode = Object.fromEntries(res.body.map((c: { code: string }) => [c.code, c]));

    expect(byCode.SAR).toMatchObject({ name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 });
    expect(byCode.AED).toMatchObject({ name: 'UAE Dirham', symbol: 'AED', decimalPlaces: 2 });
    expect(byCode.USD).toMatchObject({ name: 'US Dollar', symbol: '$', decimalPlaces: 2 });
    expect(byCode.INR).toMatchObject({ name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2 });
    expect(byCode.EUR).toMatchObject({ name: 'Euro', symbol: '€', decimalPlaces: 2 });
    expect(byCode.GBP).toMatchObject({ name: 'British Pound', symbol: '£', decimalPlaces: 2 });
  });

  it('the seed is idempotent — running it again (a second app boot) does not duplicate rows', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const secondApp = moduleRef.createNestApplication();
    await secondApp.init();
    await secondApp.close();

    const rows = await prisma.currency.findMany({ where: { code: 'SAR' } });
    expect(rows).toHaveLength(1);
  });
});
