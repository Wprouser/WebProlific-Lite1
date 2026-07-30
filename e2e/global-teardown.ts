import { createPrismaClient, wipeDatabase } from './db';

/**
 * Mirrors global-setup's wipe. Global-setup wiping on the *next* run is what
 * actually makes the suite resilient to a crashed previous run (Ctrl-C
 * skips teardown) — this runs it here too so a normal exit leaves nothing
 * behind for a human poking at the same database afterward.
 */
export default async function globalTeardown(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    await wipeDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
