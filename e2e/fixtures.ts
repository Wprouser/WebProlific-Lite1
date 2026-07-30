import { test as base, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';
import { ItemsPage } from './pages/items.page';
import { AppShellPage } from './pages/app-shell.page';
import { E2E_USER } from './seed-data';

interface Fixtures {
  /** A page already logged in as the seeded CHAIN_OWNER user, sitting on the dashboard. */
  authenticatedPage: import('@playwright/test').Page;
  itemsPage: ItemsPage;
  appShell: AppShellPage;
  /** Timestamp+random string for building collision-free names/SKUs — the
   * suite doesn't reset the database between individual tests (only once
   * per whole run, in global-setup/teardown), so tests that create data must
   * make their own names unique rather than relying on a clean slate. */
  uniqueId: string;
}

export const test = base.extend<Fixtures>({
  authenticatedPage: async ({ page }, use) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(E2E_USER.email, E2E_USER.password);
    await use(page);
  },

  itemsPage: async ({ authenticatedPage }, use) => {
    await use(new ItemsPage(authenticatedPage));
  },

  appShell: async ({ authenticatedPage }, use) => {
    await use(new AppShellPage(authenticatedPage));
  },

  uniqueId: async ({}, use) => {
    await use(`${Date.now()}${Math.floor(Math.random() * 10_000)}`);
  },
});

export { expect };
