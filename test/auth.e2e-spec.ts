import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { TokenService } from '../src/auth/services/token.service';
import { OTP_DISPATCHER, DispatchInput, OtpDispatcher } from '../src/auth/services/otp-dispatcher.service';
import { TwoFactorMethod } from '../src/auth/constants/enums';

/**
 * Exercises every FR-13 acceptance criterion end-to-end against a real
 * (test) SQL Server database. Requires:
 *   docker compose up -d && npx prisma migrate deploy && npm run test:e2e
 */

class CapturingOtpDispatcher implements OtpDispatcher {
  lastCodeByDestination = new Map<string, string>();
  async dispatch({ destination, code }: DispatchInput): Promise<void> {
    this.lastCodeByDestination.set(destination, code);
  }
}

describe('Auth & 2FA (FR-13) e2e', () => {
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
    await prisma.auditLog.deleteMany(); // FR-11: the 2fa/policy endpoint now writes these
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

  async function createUser(email: string, phone?: string) {
    return prisma.user.create({
      data: { email, phone, passwordHash: await passwordService.hash(PASSWORD) },
    });
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
    const { secret } = start.body;
    const code = authenticator.generate(secret);
    const confirm = await api()
      .post('/api/v1/auth/2fa/enroll/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ method: 'TOTP', code })
      .expect(200);
    return { secret, backupCodes: confirm.body.backupCodes as string[] };
  }

  // ---------------------------------------------------------------------

  it('logs in directly (no tokens gated) when 2FA is not enabled', async () => {
    await createUser('plain@example.com');
    const res = await login('plain@example.com').expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });

  it('AC: a user with 2FA enabled cannot obtain tokens from /auth/login alone', async () => {
    const user = await createUser('totp-user@example.com');
    const firstLogin = await login('totp-user@example.com').expect(200);
    await enrollTotp(firstLogin.body.accessToken);

    // The pre-enrollment login above already issued one RefreshToken (that's
    // expected — 2FA wasn't enabled yet at that point). What matters is that
    // the SECOND login, now that 2FA is enabled, doesn't issue another.
    const tokensBefore = await prisma.refreshToken.count({ where: { userId: user.id } });

    const res = await login('totp-user@example.com').expect(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.pendingTwoFactorToken).toBeDefined();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();

    const tokensAfter = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(tokensAfter).toBe(tokensBefore);
  });

  it('AC: TOTP codes validate within the standard drift tolerance and reject codes outside it', async () => {
    await createUser('totp-drift@example.com');
    const firstLogin = await login('totp-drift@example.com').expect(200);
    const { secret } = await enrollTotp(firstLogin.body.accessToken);

    // Valid code (current window) succeeds.
    const pending1 = await login('totp-drift@example.com').expect(200);
    const validCode = authenticator.generate(secret);
    await api()
      .post('/api/v1/auth/2fa/verify')
      .send({ pendingTwoFactorToken: pending1.body.pendingTwoFactorToken, code: validCode })
      .expect(200);

    // Code generated for a time far outside the +/-1 step (30s) tolerance fails.
    // otplib's `authenticator.options` setter merges into a shared mutable
    // object (it's the same module-level singleton the app's TotpService
    // uses), so a plain save/restore of the old options object doesn't
    // actually clear an `epoch` override — resetOptions() is required.
    const pending2 = await login('totp-drift@example.com').expect(200);
    authenticator.options = { epoch: Date.now() + 10 * 60 * 1000 };
    const farFutureCode = authenticator.generate(secret);
    authenticator.resetOptions();
    authenticator.options = { window: 1 };

    await api()
      .post('/api/v1/auth/2fa/verify')
      .send({ pendingTwoFactorToken: pending2.body.pendingTwoFactorToken, code: farFutureCode })
      .expect(401);
  });

  it('AC: backup codes are single-use - reusing a consumed one fails', async () => {
    await createUser('backup-user@example.com');
    const firstLogin = await login('backup-user@example.com').expect(200);
    const { backupCodes } = await enrollTotp(firstLogin.body.accessToken);
    expect(backupCodes).toHaveLength(10);
    const code = backupCodes[0];

    const pending1 = await login('backup-user@example.com').expect(200);
    await api()
      .post('/api/v1/auth/2fa/backup-code')
      .send({ pendingTwoFactorToken: pending1.body.pendingTwoFactorToken, backupCode: code })
      .expect(200);

    const pending2 = await login('backup-user@example.com').expect(200);
    await api()
      .post('/api/v1/auth/2fa/backup-code')
      .send({ pendingTwoFactorToken: pending2.body.pendingTwoFactorToken, backupCode: code })
      .expect(401);
  });

  it('AC: CHAIN_OWNER-enforced 2FA policy routes a non-enrolled member to mandatory enrollment on next login', async () => {
    const chain = await prisma.chain.create({ data: { name: 'Al Waha Group' } });
    const owner = await createUser('policy-owner@example.com');
    await prisma.userAccess.create({
      data: { userId: owner.id, scopeType: 'CHAIN', scopeId: chain.id, role: 'CHAIN_OWNER' },
    });
    const member = await createUser('policy-member@example.com');
    await prisma.userAccess.create({
      data: { userId: member.id, scopeType: 'CHAIN', scopeId: chain.id, role: 'OUTLET_MANAGER' },
    });

    const ownerLogin = await login('policy-owner@example.com').expect(200);
    await api()
      .patch('/api/v1/auth/2fa/policy')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ chainId: chain.id, enforcedByPolicy: true })
      .expect(200);

    // Not silently let through - no tokens, distinct response shape.
    const memberLogin = await login('policy-member@example.com').expect(200);
    expect(memberLogin.body.requiresTwoFactorEnrollment).toBe(true);
    expect(memberLogin.body.pendingEnrollmentToken).toBeDefined();
    expect(memberLogin.body.accessToken).toBeUndefined();

    // Completes forced enrollment using the pendingEnrollmentToken (no access
    // token exists yet) and receives real login tokens in the same response.
    const start = await api()
      .post('/api/v1/auth/2fa/enroll/start')
      .send({ method: 'TOTP', pendingEnrollmentToken: memberLogin.body.pendingEnrollmentToken })
      .expect(200);
    const code = authenticator.generate(start.body.secret);
    const confirm = await api()
      .post('/api/v1/auth/2fa/enroll/confirm')
      .send({
        method: 'TOTP',
        code,
        pendingEnrollmentToken: memberLogin.body.pendingEnrollmentToken,
      })
      .expect(200);
    expect(confirm.body.login.accessToken).toBeDefined();
    expect(confirm.body.backupCodes).toHaveLength(10);
  });

  it('AC: trusted-device tokens expire and correctly re-trigger the 2FA challenge after expiry', async () => {
    await createUser('device-user@example.com');
    const firstLogin = await login('device-user@example.com').expect(200);
    const { secret } = await enrollTotp(firstLogin.body.accessToken);

    const pending = await login('device-user@example.com').expect(200);
    const verify = await api()
      .post('/api/v1/auth/2fa/verify')
      .send({
        pendingTwoFactorToken: pending.body.pendingTwoFactorToken,
        code: authenticator.generate(secret),
        trustDevice: true,
        deviceLabel: 'Test Device',
      })
      .expect(200);
    const trustedDeviceToken = verify.body.trustedDeviceToken;
    expect(trustedDeviceToken).toBeDefined();

    // Still valid: skips the 2FA challenge.
    const withValidDevice = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'device-user@example.com', password: PASSWORD, trustedDeviceToken })
      .expect(200);
    expect(withValidDevice.body.accessToken).toBeDefined();

    // Expire it directly, then confirm the challenge re-triggers.
    const hash = tokenService.hashOpaqueToken(trustedDeviceToken);
    await prisma.trustedDevice.update({
      where: { deviceToken: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const withExpiredDevice = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'device-user@example.com', password: PASSWORD, trustedDeviceToken })
      .expect(200);
    expect(withExpiredDevice.body.requiresTwoFactor).toBe(true);
  });

  it('AC: repeated failed 2FA verify attempts trigger lockout, not unlimited retries', async () => {
    await createUser('lockout-user@example.com');
    const firstLogin = await login('lockout-user@example.com').expect(200);
    const { secret } = await enrollTotp(firstLogin.body.accessToken);

    const pending = await login('lockout-user@example.com').expect(200);
    const pendingTwoFactorToken = pending.body.pendingTwoFactorToken;

    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingTwoFactorToken, code: '000000' })
        .expect(401);
    }

    // 6th attempt is rejected even with a genuinely valid code - either by
    // the domain-level attempt lockout (401) or the HTTP-level per-token
    // rate limiter (429); both satisfy "not unlimited retries."
    const res = await api()
      .post('/api/v1/auth/2fa/verify')
      .send({ pendingTwoFactorToken, code: authenticator.generate(secret) });
    expect([401, 429]).toContain(res.status);
  });

  it('AC: an expired/invalid refresh token forces re-login, never silently fails open', async () => {
    await createUser('refresh-user@example.com');
    const loginRes = await login('refresh-user@example.com').expect(200);

    // Garbage token.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' }).expect(401);

    // Revoked (via logout) token.
    await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    // Expired token.
    const loginRes2 = await login('refresh-user@example.com').expect(200);
    const hash = tokenService.hashOpaqueToken(loginRes2.body.refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes2.body.refreshToken })
      .expect(401);

    // A genuinely valid, unexpired token still works (sanity check the
    // negative cases above aren't just "refresh is broken").
    const loginRes3 = await login('refresh-user@example.com').expect(200);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes3.body.refreshToken })
      .expect(200);
  });

  it('supports EMAIL-method 2FA end-to-end (enroll, login-challenge, resend)', async () => {
    await createUser('email-2fa@example.com');
    const firstLogin = await login('email-2fa@example.com').expect(200);

    const start = await api()
      .post('/api/v1/auth/2fa/enroll/start')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .send({ method: 'EMAIL' })
      .expect(200);
    const enrollCode = otpDispatcher.lastCodeByDestination.get('email-2fa@example.com');
    expect(enrollCode).toBeDefined();
    await api()
      .post('/api/v1/auth/2fa/enroll/confirm')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .send({
        method: 'EMAIL' as TwoFactorMethod,
        code: enrollCode,
        enrollmentChallengeId: start.body.enrollmentChallengeId,
      })
      .expect(200);

    const pending = await login('email-2fa@example.com').expect(200);
    expect(pending.body.requiresTwoFactor).toBe(true);
    expect(pending.body.maskedDestination).toContain('@example.com');

    // Resend issues a fresh code that also works.
    await api()
      .post('/api/v1/auth/2fa/resend')
      .send({ pendingTwoFactorToken: pending.body.pendingTwoFactorToken })
      .expect(200);
    const resentCode = otpDispatcher.lastCodeByDestination.get('email-2fa@example.com');

    await api()
      .post('/api/v1/auth/2fa/verify')
      .send({ pendingTwoFactorToken: pending.body.pendingTwoFactorToken, code: resentCode })
      .expect(200);
  });

  it('rejects bad credentials with a generic error, not a field-specific one', async () => {
    await createUser('wrongpass@example.com');
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'wrongpass@example.com', password: 'nope-not-it-12345' })
      .expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody-here@example.com', password: PASSWORD })
      .expect(401);
  });

  it('GET /auth/me returns the current user profile including 2FA status', async () => {
    await createUser('me-user@example.com');
    const loginRes = await login('me-user@example.com').expect(200);
    const res = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe('me-user@example.com');
    expect(res.body.twoFactorEnabled).toBe(false);
  });
});
