/**
 * Dev-environment seed: an account with 2FA already enabled, so the FR-13
 * two-factor login path can be exercised end to end.
 *
 * Method is EMAIL rather than TOTP deliberately — no SMS/email provider is
 * configured in this project, so ConsoleOtpDispatcherService
 * (src/auth/services/otp-dispatcher.service.ts) logs the code to the backend
 * console instead of sending it. That makes EMAIL the only 2FA method with a
 * fully self-contained round-trip on a dev machine: sign in, read the
 * `[DEV OTP] EMAIL to ...` line from the `npm run start:dev` output, type it
 * in. TOTP would need a real authenticator app seeded with the secret.
 *
 * Backup codes are generated in the same shape the app itself issues
 * (10 chars, uppercase, ambiguous characters excluded — see
 * src/auth/services/otp-code.util.ts) and stored bcrypt-hashed, so the
 * "use a backup code instead" path is testable too. They are printed once,
 * here, because that is the only time they exist in plaintext.
 *
 * Idempotent, and localhost-guarded for the same reason as seed-dev-owner.ts.
 *
 * Usage: npm run seed:dev-2fa
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

const BCRYPT_COST = 12;

const EMAIL = process.env.DEV_2FA_EMAIL ?? '2fa@webprolific.test';
const PASSWORD = process.env.DEV_2FA_PASSWORD ?? 'TwoFactor@2026!';
/** Set alongside DEV_2FA_EMAIL to move an existing account to a new address
 *  instead of creating a second one. */
const RENAME_FROM = process.env.DEV_2FA_RENAME_FROM;
const CHAIN_NAME = 'Al Waha Hospitality Group';

/** Mirrors generateBackupCode() in src/auth/services/otp-code.util.ts. */
function generateBackupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) code += alphabet[randomInt(0, alphabet.length)];
  return code;
}

function assertSafeTarget(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');

  const isLocal = /(localhost|127\.0\.0\.1|\(localdb\)|host\.docker\.internal)/i.test(url);
  if (!isLocal && !process.argv.includes('--allow-remote')) {
    throw new Error(
      'Refusing to seed a known-password account into a non-local database.\n' +
        '  If this really is a disposable remote dev DB, re-run with --allow-remote.',
    );
  }
}

async function main(): Promise<void> {
  assertSafeTarget();
  const prisma = new PrismaClient();

  try {
    const chain = await prisma.chain.findFirst({ where: { name: CHAIN_NAME } });
    if (!chain) {
      throw new Error(`Chain "${CHAIN_NAME}" not found — run \`npm run seed:dev-owner\` first.`);
    }

    // Renaming in place (rather than provisioning a second account at the new
    // address) keeps the existing UserAccess grants, activity history and
    // TrustedDevice rows attached to the same user id.
    if (RENAME_FROM && RENAME_FROM !== EMAIL) {
      const previous = await prisma.user.findUnique({ where: { email: RENAME_FROM } });
      const target = await prisma.user.findUnique({ where: { email: EMAIL } });
      if (previous && !target) {
        await prisma.user.update({ where: { id: previous.id }, data: { email: EMAIL } });
        console.log(`renamed ${RENAME_FROM} -> ${EMAIL}`);
      } else if (previous && target) {
        console.log(`note: ${EMAIL} already exists; leaving ${RENAME_FROM} untouched`);
      }
    }

    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      create: { email: EMAIL, passwordHash, isActive: true },
      update: { passwordHash, isActive: true },
    });

    await prisma.userAccess.upsert({
      where: {
        userId_scopeType_scopeId: { userId: user.id, scopeType: 'CHAIN', scopeId: chain.id },
      },
      create: { userId: user.id, scopeType: 'CHAIN', scopeId: chain.id, role: 'CHAIN_OWNER' },
      update: { role: 'CHAIN_OWNER' },
    });

    // Rebuild the 2FA record from scratch each run so re-seeding always yields
    // a known-good state (and a fresh, printable set of backup codes) rather
    // than layering onto whatever a previous test left behind.
    const existing = await prisma.twoFactorAuth.findUnique({ where: { userId: user.id } });
    if (existing) {
      await prisma.twoFactorBackupCode.deleteMany({ where: { twoFactorAuthId: existing.id } });
      await prisma.twoFactorAuth.delete({ where: { id: existing.id } });
    }
    await prisma.twoFactorChallenge.deleteMany({ where: { userId: user.id } });
    await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });

    const twoFactor = await prisma.twoFactorAuth.create({
      data: {
        userId: user.id,
        isEnabled: true,
        method: 'EMAIL',
        enrolledAt: new Date(),
      },
    });

    const codes = Array.from({ length: 10 }, () => generateBackupCode());
    await prisma.twoFactorBackupCode.createMany({
      data: await Promise.all(
        codes.map(async (code) => ({
          twoFactorAuthId: twoFactor.id,
          codeHash: await bcrypt.hash(code, BCRYPT_COST),
        })),
      ),
    });

    console.log('\n  Dev 2FA account ready');
    console.log(`  email     ${EMAIL}`);
    console.log(`  password  ${PASSWORD}`);
    console.log('  2FA       ENABLED, method=EMAIL');
    console.log(`  role      CHAIN_OWNER @ CHAIN:${chain.id}`);
    console.log('\n  On sign-in, the OTP is logged by the backend as:');
    console.log(`    [DEV OTP] EMAIL to ${EMAIL}: <6-digit code>`);
    console.log('\n  Backup codes (shown once — each is single-use):');
    for (const code of codes) console.log(`    ${code}`);
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
