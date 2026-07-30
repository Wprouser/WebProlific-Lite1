import { defineConfig, devices } from '@playwright/test';
import { requireDatabaseUrl } from './e2e/db';

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_PORT = 3000;

// Fails fast, before starting anything (browser, backend, frontend) — this
// suite must never silently fall back to the dev (.env) or backend-Jest-e2e
// (.env.test) database. Ask the user for a dedicated, disposable database
// URL every time this suite is run (never assume/reuse a previous one), and
// set it as PLAYWRIGHT_DATABASE_URL for that invocation. See e2e/db.ts.
const databaseUrl = requireDatabaseUrl();

export default defineConfig({
  testDir: './e2e/tests',
  // Default 30s is tight with a deliberately slowed-down (slowMo: 150),
  // visible browser plus real network round-trips to a cold local Nest
  // process — give individual tests more headroom before diagnosing a
  // timeout as a real bug.
  timeout: 60_000,
  // Specs currently share seeded fixture data (one outlet, one category/
  // unit) rather than each creating its own tenant — see e2e/global-setup.ts
  // — so keep this serial. Only parallelize once every spec's data is
  // provably independent (Step 2's parallelism note).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: FRONTEND_URL,
    locale: 'en-US',
    // Always a visible browser, in every environment — this is an on-demand
    // suite the user watches run before merging, never a headless-only CI
    // job. Do not gate this on process.env.CI.
    headless: false,
    launchOptions: { slowMo: 150 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start:dev',
      // A plain TCP check, not an HTTP GET: every route is behind the
      // global JwtAuthGuard (see src/app.module.ts) and there is no
      // unauthenticated 2xx endpoint to poll — an HTTP `url` check would
      // see 404/401 forever and never consider the server "ready".
      port: BACKEND_PORT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      // Never reuse an already-running dev server here, even locally — a
      // server started before this config ran would still be bound to
      // whatever DATABASE_URL *it* started with (almost certainly the real
      // dev database from .env), and reusing it would silently run every
      // test against the wrong database instead of the dedicated one above.
      // If port 3000 is already in use, stop that server first.
      reuseExistingServer: false,
      // Nest's webpack/ts-loader cold compile plus a concurrent Vite
      // startup can comfortably exceed 60s on a first run — 120s avoids a
      // false-negative timeout rather than the app actually failing to boot.
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: './web',
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
