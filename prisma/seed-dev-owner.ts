/**
 * Dev-environment seed: a real, loggable CHAIN_OWNER account.
 *
 * Why a seed script and not the app's own FR-14 invite flow: `POST /users/invite`
 * is gated behind `@Roles('CHAIN_OWNER','PROPERTY_MANAGER')`
 * (src/users/controllers/users.controller.ts), so issuing the *first*
 * CHAIN_OWNER invite requires a CHAIN_OWNER to already exist. Bootstrapping
 * that first account is necessarily out-of-band. Every subsequent user should
 * be created through the real invite flow, signed in as this account.
 *
 * The password hash is produced with the same bcrypt cost as
 * src/auth/services/password.service.ts, so it is indistinguishable from one
 * the app itself would have written — this is a real credential, not a
 * dev-shortcut/mock session.
 *
 * No TwoFactorAuth row is created (and any existing one for this user is
 * removed), which is what keeps 2FA off: AuthService.completeLoginFlow only
 * challenges/enrolls when a TwoFactorAuth row exists with isEnabled or
 * enforcedByPolicy set. Absent row => straight to token issuance.
 *
 * Idempotent: re-running updates the password and re-asserts the grant rather
 * than erroring or creating duplicates. Safe to run after `prisma migrate reset`.
 *
 * Usage:
 *   npm run seed:dev-owner
 *   DEV_OWNER_PASSWORD='SomethingElse!1' npm run seed:dev-owner   (choose your own)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Matches BCRYPT_COST in src/auth/services/password.service.ts.
const BCRYPT_COST = 12;

const EMAIL = process.env.DEV_OWNER_EMAIL ?? 'owner@webprolific.test';
const PASSWORD = process.env.DEV_OWNER_PASSWORD ?? 'Owner@2026!';

const CHAIN_NAME = 'Al Waha Hospitality Group';
const PROPERTY_NAME = 'Jeddah Hotel';
const OUTLET_NAME = 'Main Restaurant';

/**
 * This script writes a known-password account, so it must never be pointed at
 * a deployed database by accident (e.g. a stale DATABASE_URL from .env.production
 * or a Render connection string left in the shell). Localhost-only unless
 * explicitly overridden with --allow-remote.
 */
function assertSafeTarget(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');

  const isLocal = /(localhost|127\.0\.0\.1|\(localdb\)|host\.docker\.internal)/i.test(url);
  if (!isLocal && !process.argv.includes('--allow-remote')) {
    throw new Error(
      'Refusing to seed a known-password account into a non-local database.\n' +
        `  DATABASE_URL host does not look like localhost.\n` +
        '  If this really is a disposable remote dev DB, re-run with --allow-remote.',
    );
  }
}

async function main(): Promise<void> {
  assertSafeTarget();
  const prisma = new PrismaClient();

  try {
    // --- Tenancy: reuse what's there, create only what's missing, so this
    // works both against the current dev DB and a freshly-reset one.
    let chain = await prisma.chain.findFirst({ where: { name: CHAIN_NAME } });
    if (!chain) {
      chain = await prisma.chain.create({
        data: { name: CHAIN_NAME, baseCurrency: 'SAR' },
      });
      console.log(`created chain      ${CHAIN_NAME}`);
    }

    let property = await prisma.property.findFirst({
      where: { chainId: chain.id, name: PROPERTY_NAME },
    });
    if (!property) {
      property = await prisma.property.create({
        data: { chainId: chain.id, name: PROPERTY_NAME, type: 'HOTEL' },
      });
      console.log(`created property   ${PROPERTY_NAME}`);
    }

    const outlet = await prisma.outlet.findFirst({
      where: { propertyId: property.id, name: OUTLET_NAME },
    });
    if (!outlet) {
      await prisma.outlet.create({
        data: {
          propertyId: property.id,
          chainId: chain.id,
          name: OUTLET_NAME,
          type: 'RESTAURANT',
        },
      });
      console.log(`created outlet     ${OUTLET_NAME}`);
    }

    // --- The account itself.
    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      create: { email: EMAIL, passwordHash, isActive: true },
      update: { passwordHash, isActive: true },
    });

    // --- CHAIN-scoped grant. ScopeResolutionService cascades a CHAIN grant to
    // every property and outlet under it, so this one row is full-hierarchy access.
    await prisma.userAccess.upsert({
      where: {
        userId_scopeType_scopeId: {
          userId: user.id,
          scopeType: 'CHAIN',
          scopeId: chain.id,
        },
      },
      create: {
        userId: user.id,
        scopeType: 'CHAIN',
        scopeId: chain.id,
        role: 'CHAIN_OWNER',
      },
      update: { role: 'CHAIN_OWNER' },
    });

    // --- Guarantee 2FA is off for this account (see header note).
    await prisma.twoFactorBackupCode.deleteMany({ where: { twoFactorAuth: { userId: user.id } } });
    await prisma.twoFactorChallenge.deleteMany({ where: { userId: user.id } });
    await prisma.twoFactorAuth.deleteMany({ where: { userId: user.id } });

    const outletCount = await prisma.outlet.count({ where: { chainId: chain.id } });

    console.log('\n  Dev CHAIN_OWNER ready');
    console.log(`  email     ${EMAIL}`);
    console.log(`  password  ${PASSWORD}`);
    console.log(`  role      CHAIN_OWNER @ CHAIN:${chain.id} (${CHAIN_NAME})`);
    console.log(`  access    ${outletCount} outlet(s) in this chain`);
    console.log('  2FA       disabled\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
