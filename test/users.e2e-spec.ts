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
 * Exercises every FR-14 acceptance criterion end-to-end against a real
 * (test) SQL Server database. Requires:
 *   docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */
describe('User Management (FR-14) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let otpDispatcher: CapturingOtpDispatcher;

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

  it('AC: an invited user cannot log in until they accept the invite, then can afterward', async () => {
    const { chain } = await chainWithProperty();
    const owner = await actor('owner@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    const invite = await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        email: 'chef@example.com',
        grants: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'CHEF' }],
      })
      .expect(200);
    expect(invite.body.userId).toBeDefined();

    // Cannot log in yet — no password set.
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'chef@example.com', password: 'anything-at-all' })
      .expect(401);

    const rawToken = otpDispatcher.lastCodeByDestination.get('chef@example.com');
    expect(rawToken).toBeDefined();

    const accept = await api()
      .post(`/api/v1/users/invite/${rawToken}/accept`)
      .send({ password: 'NewPassw0rd!1' })
      .expect(200);
    expect(accept.body.accessToken).toBeDefined();

    // Now logs in normally.
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'chef@example.com', password: 'NewPassw0rd!1' })
      .expect(200);
  });

  it('AC: a PROPERTY_MANAGER cannot grant access outside their own property, even inviting fresh', async () => {
    const { chain, property } = await chainWithProperty();
    const otherProperty = await prisma.property.create({
      data: { chainId: chain.id, name: 'Riyadh Hotel', type: 'HOTEL' },
    });
    const pm = await actor('pm@example.com', 'PROPERTY', property.id, 'PROPERTY_MANAGER');

    // Own property: fine.
    await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${pm.token}`)
      .send({
        email: 'staff-own@example.com',
        grants: [{ scopeType: 'PROPERTY', scopeId: property.id, role: 'OUTLET_MANAGER' }],
      })
      .expect(200);

    // Sibling property: 403.
    await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${pm.token}`)
      .send({
        email: 'staff-other@example.com',
        grants: [{ scopeType: 'PROPERTY', scopeId: otherProperty.id, role: 'OUTLET_MANAGER' }],
      })
      .expect(403);

    // CHAIN-scoped grant: 403.
    await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${pm.token}`)
      .send({
        email: 'staff-chain@example.com',
        grants: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'PROPERTY_MANAGER' }],
      })
      .expect(403);
  });

  it('AC: deactivating a user blocks login immediately and preserves grants/records', async () => {
    const { chain } = await chainWithProperty();
    const owner = await actor('owner2@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
    const target = await actor('target@example.com', 'CHAIN', chain.id, 'OUTLET_MANAGER');
    // Give the target a real password so login would otherwise succeed.
    await prisma.user.update({
      where: { id: target.userId },
      data: { passwordHash: await passwordService.hash('TargetPass1!') },
    });

    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'target@example.com', password: 'TargetPass1!' })
      .expect(200);

    await api()
      .delete(`/api/v1/users/${target.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'target@example.com', password: 'TargetPass1!' })
      .expect(401);

    // Grants are retained, not deleted, even though ignored while inactive.
    const grants = await prisma.userAccess.findMany({ where: { userId: target.userId } });
    expect(grants.length).toBeGreaterThan(0);
  });

  it('AC: expired invite tokens are rejected with a clear message', async () => {
    const { chain } = await chainWithProperty();
    const owner = await actor('owner3@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');

    await api()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        email: 'expiring@example.com',
        grants: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'CHEF' }],
      })
      .expect(200);

    const rawToken = otpDispatcher.lastCodeByDestination.get('expiring@example.com')!;
    const hash = tokenService.hashOpaqueToken(rawToken);
    await prisma.inviteToken.updateMany({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api()
      .post(`/api/v1/users/invite/${rawToken}/accept`)
      .send({ password: 'WhateverPass1!' })
      .expect(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('AC: a user with grants at multiple outlets sees a correct combined effectiveOutletIds list', async () => {
    const { chain, property } = await chainWithProperty();
    const propertyB = await prisma.property.create({
      data: { chainId: chain.id, name: 'Second Hotel', type: 'HOTEL' },
    });
    const outletA = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: 'Outlet A', type: 'RESTAURANT' },
    });
    const outletB = await prisma.outlet.create({
      data: { propertyId: propertyB.id, chainId: chain.id, name: 'Outlet B', type: 'BAR' },
    });
    const owner = await actor('owner4@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
    const multi = await actor('multi@example.com', 'OUTLET', outletA.id, 'STORE_STAFF');
    await prisma.userAccess.create({
      data: { userId: multi.userId, scopeType: 'OUTLET', scopeId: outletB.id, role: 'STORE_STAFF' },
    });
    void owner;

    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'multi@example.com', password: 'Passw0rd!123' })
      .expect(200);
    expect(res.body.user.effectiveOutletIds.sort()).toEqual([outletA.id, outletB.id].sort());
  });

  describe('access grant management + audit log', () => {
    it('lists users scoped to the caller and shows grant detail', async () => {
      const { chain, property } = await chainWithProperty();
      const owner = await actor('owner5@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
      const member = await actor('member@example.com', 'PROPERTY', property.id, 'OUTLET_MANAGER');
      void member;

      const list = await api()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const emails = list.body.map((u: { email: string }) => u.email);
      expect(emails).toEqual(expect.arrayContaining(['owner5@example.com', 'member@example.com']));

      const detail = await api()
        .get(`/api/v1/users/${member.userId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(detail.body.grants).toHaveLength(1);
      expect(detail.body.status).toBe('ACTIVE');
    });

    it('adds and removes grants via PATCH /users/:id/access, and logs an AuditLog row', async () => {
      const { chain, property } = await chainWithProperty();
      const owner = await actor('owner6@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
      const target = await actor('target2@example.com', 'PROPERTY', property.id, 'OUTLET_MANAGER');

      const before = await prisma.userAccess.findMany({ where: { userId: target.userId } });
      expect(before).toHaveLength(1);

      await api()
        .patch(`/api/v1/users/${target.userId}/access`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          add: [{ scopeType: 'CHAIN', scopeId: chain.id, role: 'PROPERTY_MANAGER' }],
          removeGrantIds: [before[0].id],
        })
        .expect(200);

      const after = await prisma.userAccess.findMany({ where: { userId: target.userId } });
      expect(after).toHaveLength(1);
      expect(after[0].scopeType).toBe('CHAIN');

      const auditRows = await prisma.auditLog.findMany({
        where: { entityType: 'User', entityId: target.userId, action: 'UPDATE_USER_ACCESS' },
      });
      expect(auditRows).toHaveLength(1);
    });
  });

  describe('admin-triggered resets (require the admin\'s own re-authentication)', () => {
    async function enrollAdminTotp(token: string) {
      const start = await api()
        .post('/api/v1/auth/2fa/enroll/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'TOTP' })
        .expect(200);
      const code = authenticator.generate(start.body.secret);
      await api()
        .post('/api/v1/auth/2fa/enroll/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'TOTP', code })
        .expect(200);
      return start.body.secret;
    }

    it('rejects admin reset endpoints without a valid current 2FA code', async () => {
      const { chain } = await chainWithProperty();
      const owner = await actor('owner7@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
      const target = await actor('target3@example.com', 'CHAIN', chain.id, 'CHEF');

      // Admin has no 2FA enabled at all -> rejected outright.
      await api()
        .post(`/api/v1/users/${target.userId}/reset-2fa-admin`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Passw0rd!123', code: '000000' })
        .expect(401);
    });

    it('resets a target user\'s password and 2FA once the admin re-authenticates', async () => {
      const { chain } = await chainWithProperty();
      const owner = await actor('owner8@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
      const target = await actor('target4@example.com', 'CHAIN', chain.id, 'CHEF');

      const secret = await enrollAdminTotp(owner.token);

      await api()
        .post(`/api/v1/users/${target.userId}/reset-password-admin`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Passw0rd!123', code: authenticator.generate(secret) })
        .expect(200);
      expect(otpDispatcher.lastCodeByDestination.get('target4@example.com')).toBeDefined();

      // Give target 2FA to reset.
      await prisma.twoFactorAuth.create({
        data: { userId: target.userId, isEnabled: true, method: 'TOTP', totpSecret: 'irrelevant' },
      });

      await api()
        .post(`/api/v1/users/${target.userId}/reset-2fa-admin`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Passw0rd!123', code: authenticator.generate(secret) })
        .expect(200);

      const targetTwoFactor = await prisma.twoFactorAuth.findUnique({ where: { userId: target.userId } });
      expect(targetTwoFactor?.isEnabled).toBe(false);

      const auditRows = await prisma.auditLog.findMany({
        where: { entityType: 'User', entityId: target.userId },
      });
      expect(auditRows.map((r) => r.action).sort()).toEqual(
        ['ADMIN_RESET_2FA', 'ADMIN_RESET_PASSWORD'].sort(),
      );
    });

    it('GET /users/:id/audit-log returns actions performed BY that user (spec: "actions performed by this user")', async () => {
      const { chain } = await chainWithProperty();
      const owner = await actor('owner9@example.com', 'CHAIN', chain.id, 'CHAIN_OWNER');
      const target = await actor('target5@example.com', 'CHAIN', chain.id, 'CHEF');
      const secret = await enrollAdminTotp(owner.token);

      // owner is the actor here, target is merely the entity acted upon —
      // so the row belongs under owner's audit log, not target's.
      await api()
        .post(`/api/v1/users/${target.userId}/reset-password-admin`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Passw0rd!123', code: authenticator.generate(secret) })
        .expect(200);

      const ownerLog = await api()
        .get(`/api/v1/users/${owner.userId}/audit-log`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(ownerLog.body).toHaveLength(1);
      expect(ownerLog.body[0].action).toBe('ADMIN_RESET_PASSWORD');

      const targetLog = await api()
        .get(`/api/v1/users/${target.userId}/audit-log`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(targetLog.body).toHaveLength(0);
    });
  });
});
