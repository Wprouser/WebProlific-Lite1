import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import { OTP_DISPATCHER, DispatchInput, OtpDispatcher } from '../src/auth/services/otp-dispatcher.service';

class CapturingOtpDispatcher implements OtpDispatcher {
  lastCodeByDestination = new Map<string, string>();
  async dispatch({ destination, code }: DispatchInput): Promise<void> {
    this.lastCodeByDestination.set(destination, code);
  }
}

/**
 * Exercises FR-18's acceptance criteria end-to-end against a real (test)
 * SQL Server database, retrofitted into the FR-00/FR-11/FR-13/FR-14
 * endpoints built before it. Requires:
 *   docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('Activity & Transaction Log (FR-18) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let otpDispatcher: CapturingOtpDispatcher;

  const PASSWORD = 'Passw0rd!123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_DISPATCHER)
      .useClass(CapturingOtpDispatcher)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    tokenService = app.get(TokenService);
    otpDispatcher = app.get(OTP_DISPATCHER);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.activityLog.deleteMany();
    await prisma.transactionLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.inviteToken.deleteMany();
    await prisma.twoFactorBackupCode.deleteMany();
    await prisma.twoFactorChallenge.deleteMany();
    await prisma.trustedDevice.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.twoFactorAuth.deleteMany();
    await prisma.userAccess.deleteMany();
    await prisma.outlet.deleteMany();
    await prisma.property.deleteMany();
    await prisma.chain.deleteMany();
    await prisma.user.deleteMany();
    otpDispatcher.lastCodeByDestination.clear();
  });

  const api = () => request(app.getHttpServer());

  async function createUser(email: string) {
    return prisma.user.create({ data: { email, passwordHash: await passwordService.hash(PASSWORD) } });
  }

  async function actor(email: string, scopeType: 'CHAIN' | 'PROPERTY' | 'OUTLET', scopeId: string, role: string) {
    const user = await createUser(email);
    await prisma.userAccess.create({ data: { userId: user.id, scopeType, scopeId, role } });
    return { userId: user.id, token: tokenService.signAccessToken(user.id) };
  }

  function login(email: string) {
    return api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  }

  async function enrollTotp(accessToken: string) {
    const start = await api()
      .post('/api/v1/auth/2fa/enroll/start')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ method: 'TOTP' })
      .expect(200);
    const secret = start.body.secret as string;
    const code = authenticator.generate(secret);
    await api()
      .post('/api/v1/auth/2fa/enroll/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ method: 'TOTP', code })
      .expect(200);
    return secret;
  }

  // ---------------------------------------------------------------------
  // AC: field-level TransactionLog rows (revised FR-18)
  // ---------------------------------------------------------------------

  it('AC: updating two fields on an outlet produces exactly two TransactionLog rows, one per field, regardless of monetary value', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' },
    });
    const { token } = await actor('outlet-owner@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    await api()
      .patch(`/api/v1/outlets/${outlet.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Main Restaurant (Renamed)', type: 'BAR' })
      .expect(200);

    const rows = await prisma.transactionLog.findMany({ where: { entityId: outlet.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entityCategory === 'MASTER_DATA')).toBe(true);
    expect(rows.every((r) => r.operation === 'UPDATE')).toBe(true);
    const byField = Object.fromEntries(rows.map((r) => [r.fieldName, { old: r.oldValue, new: r.newValue }]));
    expect(byField.name).toEqual({ old: 'Main Restaurant', new: 'Main Restaurant (Renamed)' });
    expect(byField.type).toEqual({ old: 'RESTAURANT', new: 'BAR' });
    // valueAmount is optional enrichment, not the defining criterion — this
    // rename has no monetary dimension and still produced rows.
    expect(rows.every((r) => r.valueAmount === null)).toBe(true);
  });

  it('AC: creating an outlet produces exactly one TransactionLog row (fieldName null)', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const { token } = await actor('creator@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    const res = await api()
      .post(`/api/v1/properties/${property.id}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pool Bar', type: 'BAR' })
      .expect(201);

    const rows = await prisma.transactionLog.findMany({ where: { entityId: res.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('CREATE');
    expect(rows[0].fieldName).toBeNull();
  });

  it('AC: creating a chain (no outlet at all) still produces a TransactionLog row, scoped by chainId', async () => {
    const owner = await createUser('no-outlet@example.com');

    const res = await api()
      .post('/api/v1/chains')
      .set('Authorization', `Bearer ${tokenService.signAccessToken(owner.id)}`)
      .send({ name: 'No Outlet Chain' })
      .expect(201);

    const rows = await prisma.transactionLog.findMany({ where: { entityId: res.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].chainId).toBe(res.body.id);
    expect(rows[0].outletId).toBeNull();
  });

  it('AC: renaming a property produces a TransactionLog row scoped by both propertyId and its parent chainId', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const { token } = await actor('property-renamer@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    await api()
      .patch(`/api/v1/properties/${property.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jeddah Grand Hotel' })
      .expect(200);

    const rows = await prisma.transactionLog.findMany({ where: { entityId: property.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].propertyId).toBe(property.id);
    expect(rows[0].chainId).toBe(chain.id);
    expect(rows[0].fieldName).toBe('name');
  });

  it('AC: inviting a user (User-level, no chain/property/outlet of its own) produces no TransactionLog row — documented backlog', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const { token } = await actor('inviter2@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
    const before = await prisma.transactionLog.count();

    await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'invitee2@example.com', grants: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'OUTLET_MANAGER' }] })
      .expect(200);

    expect(await prisma.transactionLog.count()).toBe(before);
  });

  it("AC: actions that don't change tracked entity data (login) produce ActivityLog only, no TransactionLog row", async () => {
    await createUser('no-txn-login@example.com');
    const before = await prisma.transactionLog.count();

    await login('no-txn-login@example.com').expect(200);

    expect(await prisma.transactionLog.count()).toBe(before);
  });

  // ---------------------------------------------------------------------
  // AC: every mutating action produces exactly one ActivityLog entry
  // ---------------------------------------------------------------------

  it('AC: a FR-00 mutating action (create chain) produces exactly one ActivityLog entry', async () => {
    const owner = await createUser('owner@example.com');
    const before = await prisma.activityLog.count();

    const res = await api()
      .post('/api/v1/chains')
      .set('Authorization', `Bearer ${tokenService.signAccessToken(owner.id)}`)
      .send({ name: 'Al Waha Group' })
      .expect(201);

    const rows = await prisma.activityLog.findMany({ where: { entityId: res.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('SETTINGS');
    expect(rows[0].action).toBe('CREATE_CHAIN');
    expect(rows[0].chainId).toBe(res.body.id);
    // Description is a message key, not a frozen English sentence — FR-15's
    // "renders correctly localized... without separate stored copies" only
    // works if the stored value is a lookup key.
    expect(rows[0].description).toMatch(/^activity\./);
    expect(await prisma.activityLog.count()).toBe(before + 1);
  });

  it('AC: a FR-13 login produces exactly one LOGIN_SUCCESS ActivityLog entry', async () => {
    const user = await createUser('login-user@example.com');

    await login('login-user@example.com').expect(200);

    const rows = await prisma.activityLog.findMany({
      where: { userId: user.id, action: 'LOGIN_SUCCESS' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('AUTH');
  });

  it('AC: a failed login (wrong password for a real account) produces a LOGIN_FAILED entry', async () => {
    const user = await createUser('failer@example.com');

    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'failer@example.com', password: 'wrong-password' })
      .expect(401);

    const rows = await prisma.activityLog.findMany({
      where: { userId: user.id, action: 'LOGIN_FAILED' },
    });
    expect(rows).toHaveLength(1);
  });

  it('AC: a login attempt against a nonexistent email produces no ActivityLog entry (avoids scan/bot noise)', async () => {
    const before = await prisma.activityLog.count();
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'irrelevant' })
      .expect(401);
    expect(await prisma.activityLog.count()).toBe(before);
  });

  it('AC: logout produces exactly one LOGOUT ActivityLog entry', async () => {
    const user = await createUser('logout-user@example.com');
    const loginRes = await login('logout-user@example.com').expect(200);

    await api().post('/api/v1/auth/logout').send({ refreshToken: loginRes.body.refreshToken }).expect(200);

    const rows = await prisma.activityLog.findMany({ where: { userId: user.id, action: 'LOGOUT' } });
    expect(rows).toHaveLength(1);
  });

  it('AC: enabling and disabling 2FA each produce exactly one ActivityLog entry', async () => {
    const user = await createUser('2fa-user@example.com');
    const loginRes = await login('2fa-user@example.com').expect(200);
    const secret = await enrollTotp(loginRes.body.accessToken);

    const enabledRows = await prisma.activityLog.findMany({
      where: { userId: user.id, action: '2FA_ENABLED' },
    });
    expect(enabledRows).toHaveLength(1);

    // A fresh login now goes through the 2FA challenge before token issuance.
    const pending = await login('2fa-user@example.com').expect(200);
    const verify = await api()
      .post('/api/v1/auth/2fa/verify')
      .send({ pendingTwoFactorToken: pending.body.pendingTwoFactorToken, code: authenticator.generate(secret) })
      .expect(200);

    await api()
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${verify.body.accessToken}`)
      .send({ password: PASSWORD, code: authenticator.generate(secret) })
      .expect(200);

    const disabledRows = await prisma.activityLog.findMany({
      where: { userId: user.id, action: '2FA_DISABLED' },
    });
    expect(disabledRows).toHaveLength(1);
  });

  it('AC: a FR-14 user-management action (invite) produces exactly one USER_MGMT ActivityLog entry', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const { token } = await actor('inviter@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    const res = await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'invitee@example.com', grants: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'OUTLET_MANAGER' }] })
      .expect(200);

    const rows = await prisma.activityLog.findMany({ where: { entityId: res.body.userId, action: 'INVITE_USER' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('USER_MGMT');
  });

  // ---------------------------------------------------------------------
  // AC: filtering respects the viewer's effective outlet/property/chain scope
  // ---------------------------------------------------------------------

  it('AC: a PROPERTY_MANAGER never sees another property\'s ActivityLog entries', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const propertyA = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const propertyB = await prisma.property.create({
      data: { chainId: chain.id, name: 'Riyadh Hotel', type: 'HOTEL' },
    });
    const { token: ownerToken } = await actor('owner2@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
    const { token: mgrAToken } = await actor('mgrA@example.com', 'PROPERTY', propertyA.id, 'PROPERTY_MANAGER');

    // Rename each property (an UPDATE_PROPERTY AuditLog/ActivityLog write) so
    // each property has its own distinguishable ActivityLog row.
    await api()
      .patch(`/api/v1/properties/${propertyA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Jeddah Hotel (renamed)' })
      .expect(200);
    await api()
      .patch(`/api/v1/properties/${propertyB.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Riyadh Hotel (renamed)' })
      .expect(200);

    const res = await api()
      .get('/api/v1/activity-log')
      .set('Authorization', `Bearer ${mgrAToken}`)
      .expect(200);

    const propertyIds = new Set(res.body.map((r: { propertyId: string | null }) => r.propertyId));
    expect(propertyIds.has(propertyA.id)).toBe(true);
    expect(propertyIds.has(propertyB.id)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // TransactionLog + export
  // ---------------------------------------------------------------------

  it('AC: transaction-log filtering is scoped to the viewer\'s effective outlets', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: 'Jeddah Hotel', type: 'HOTEL' },
    });
    const outletA = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Main Restaurant', type: 'RESTAURANT' },
    });
    const outletB = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Pool Bar', type: 'BAR' },
    });
    await prisma.transactionLog.create({
      data: {
        outletId: outletA.id,
        entityCategory: 'TRANSACTIONAL',
        entityType: 'GRN',
        entityId: 'grn-1',
        operation: 'CREATE',
        valueAmount: 1566,
        currencyCode: 'SAR',
        summary: 'activity.transactionLog.created',
      },
    });
    await prisma.transactionLog.create({
      data: {
        outletId: outletB.id,
        entityCategory: 'TRANSACTIONAL',
        entityType: 'GRN',
        entityId: 'grn-2',
        operation: 'CREATE',
        valueAmount: 300,
        currencyCode: 'SAR',
        summary: 'activity.transactionLog.created',
      },
    });
    const { token } = await actor('outlet-mgr@example.com', 'OUTLET', outletA.id, 'OUTLET_MANAGER');

    const res = await api()
      .get('/api/v1/transaction-log')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].outletId).toBe(outletA.id);
  });

  it('AC: export produces a complete, correctly formatted file for the filtered range', async () => {
    const owner = await createUser('exporter@example.com');
    const ownerToken = tokenService.signAccessToken(owner.id);
    const chainRes = await api()
      .post('/api/v1/chains')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Export Test Chain' })
      .expect(201);
    // Grant the creator ownership so they have a resolvable effectiveRole —
    // POST /chains itself is deliberately ungated (admin-provisioning), but
    // GET /activity-log requires the caller to actually hold a role.
    await prisma.userAccess.create({
      data: { userId: owner.id, scopeType: 'CHAIN', scopeId: chainRes.body.id, role: 'CHAIN_OWNER' },
    });

    const res = await api()
      .get('/api/v1/activity-log/export?format=xlsx')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(Buffer.isBuffer(res.body) ? res.body.length : res.text.length).toBeGreaterThan(0);
  });
});
