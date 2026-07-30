import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as bcrypt from 'bcryptjs';
import { createPrismaClient, requireDatabaseUrl, wipeDatabase } from './db';
import {
  E2E_CATEGORY_NAME,
  E2E_CHAIN_NAME,
  E2E_OUTLET_NAME,
  E2E_PROPERTY_NAME,
  E2E_UNIT,
  E2E_USER,
} from './seed-data';

// Matches PasswordService's bcrypt cost (src/auth/services/password.service.ts)
// — not load-bearing for correctness, just keeps the seeded hash consistent
// with how the app itself would have produced it.
const BCRYPT_COST = 12;

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Runs once before the backend/frontend dev servers start (and therefore
 * before any test). Migrates the dedicated e2e database to the current
 * schema, wipes it, then seeds the minimum fixture data every spec depends
 * on: a Chain -> Property -> Outlet, a CHAIN_OWNER user, and one Category +
 * UnitOfMeasure (so the item-create form's dropdowns are never empty).
 *
 * Chain/Property/Outlet are seeded via direct Prisma inserts, not through
 * the NestJS app/HTTP layer — same convention the backend's own Jest e2e
 * suites use (see test/tenancy.e2e-spec.ts) — which means FR-01's
 * DefaultCategoriesListener/DefaultUnitsListener (only wired to fire on a
 * real outlet-created event) never runs here; that's why Category/
 * UnitOfMeasure are seeded explicitly below instead of relied on.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: true,
  });

  const prisma = createPrismaClient();
  try {
    await wipeDatabase(prisma);

    const chain = await prisma.chain.create({ data: { name: E2E_CHAIN_NAME } });
    const property = await prisma.property.create({
      data: { chainId: chain.id, name: E2E_PROPERTY_NAME, type: 'HOTEL' },
    });
    const outlet = await prisma.outlet.create({
      data: { propertyId: property.id, chainId: chain.id, name: E2E_OUTLET_NAME, type: 'STORE' },
    });

    const passwordHash = await bcrypt.hash(E2E_USER.password, BCRYPT_COST);
    const user = await prisma.user.create({
      data: { email: E2E_USER.email, passwordHash },
    });
    await prisma.userAccess.create({
      data: { userId: user.id, scopeType: 'CHAIN', scopeId: chain.id, role: 'CHAIN_OWNER' },
    });

    await prisma.category.create({ data: { name: E2E_CATEGORY_NAME, outletId: outlet.id } });
    await prisma.unitOfMeasure.create({
      data: { name: E2E_UNIT.name, abbreviation: E2E_UNIT.abbreviation, outletId: outlet.id },
    });

    console.log(
      `[global-setup] seeded user ${user.email} (id=${user.id}) with CHAIN_OWNER access on chain ${chain.id}, outlet ${outlet.id}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
