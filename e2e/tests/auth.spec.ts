import { test, expect } from '../fixtures';
import { LoginPage } from '../pages/login.page';
import { E2E_USER } from '../seed-data';

test.describe('Login (FR-13)', () => {
  test('signs in with valid credentials and reaches the dashboard', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(E2E_USER.email, E2E_USER.password);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('rejects an invalid password with a visible error and stays on /login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.submit(E2E_USER.email, 'not-the-real-password');
    await expect(login.errorMessage()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logs out back to the login screen', async ({ authenticatedPage: page, appShell }) => {
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await appShell.logout(E2E_USER.email);
  });
});
