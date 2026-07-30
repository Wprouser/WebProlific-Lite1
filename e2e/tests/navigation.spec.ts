import { test, expect } from '../fixtures';

test.describe('Navigation shell', () => {
  test('a signed-in CHAIN_OWNER sees the built-out primary nav destinations', async ({ authenticatedPage: page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Items' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Stock' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Suppliers' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Purchase Orders' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'GRN' })).toBeVisible();

    await nav.getByRole('link', { name: 'Items' }).click();
    await expect(page).toHaveURL(/\/items$/);
    await expect(page.getByRole('heading', { name: 'Items', level: 1 })).toBeVisible();
  });
});
