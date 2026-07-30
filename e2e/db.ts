import { PrismaClient } from '@prisma/client';

/**
 * This suite refuses to guess a database — it must run against a dedicated,
 * disposable database, never the dev DB (.env) or the backend Jest e2e DB
 * (.env.test), since its cleanup wipes every row in every table it touches.
 * See playwright.config.ts, which also fails fast on this at config-load
 * time before any server or browser is started.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.PLAYWRIGHT_DATABASE_URL;
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_DATABASE_URL is not set.\n' +
        'This suite always runs against a fresh, dedicated database — ask the ' +
        'user for one (or offer to create a new database on the local dev SQL ' +
        'Server instance) before every run; never reuse the dev or backend-e2e ' +
        'database. Example (PowerShell):\n' +
        '  $env:PLAYWRIGHT_DATABASE_URL = "sqlserver://localhost:1433;database=webprolific_e2e_ui;user=sa;password=...;trustServerCertificate=true"\n' +
        '  npm run test:e2e:ui',
    );
  }
  return url;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: requireDatabaseUrl() } } });
}

/**
 * Full wipe, not a marker-scoped delete — only safe because this suite's
 * database is dedicated entirely to it (enforced by requireDatabaseUrl).
 * FK-safe order: children before parents. Run in both global-setup and
 * global-teardown so the suite recovers even if a previous run crashed
 * mid-test (setup) and still cleans up after itself on a normal exit
 * (teardown) — see the skill's Step 3/7 on why both matter.
 */
export async function wipeDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.gRNLineTaxComponent.deleteMany();
  await prisma.gRNLine.deleteMany();
  await prisma.gRN.deleteMany();
  await prisma.pOLineTaxComponent.deleteMany();
  await prisma.pOLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.invoiceScan.deleteMany();
  await prisma.supplierPriceHistory.deleteMany();
  await prisma.stockTransaction.deleteMany();
  await prisma.itemImage.deleteMany();
  await prisma.item.deleteMany();
  await prisma.taxRateComponent.deleteMany();
  await prisma.taxRate.deleteMany();
  await prisma.unitOfMeasure.deleteMany();
  await prisma.category.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.exchangeRate.deleteMany();
  await prisma.currency.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.transactionLog.deleteMany();
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
}
