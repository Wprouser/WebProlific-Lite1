import { expect, type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login', { waitUntil: 'networkidle' });
  }

  async submit(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    // Click-then-assert race: the click itself resolves as soon as the
    // event dispatches, before the POST /auth/login round-trip (and its
    // bcrypt compare) completes — wait for that response, not just the
    // click, or a caller's very next assertion can run while the button
    // still reads "Signing in…".
    const response = this.page.waitForResponse((res) => res.url().includes('/api/v1/auth/login'));
    await this.page.getByRole('button', { name: 'Sign in' }).click();
    await response;
  }

  async login(email: string, password: string): Promise<void> {
    await this.submit(email, password);
    // Login navigates to '/' (Dashboard) only on success — a stronger signal
    // than "no error text visible", and one that also fails loudly (via
    // toHaveURL's own timeout) if login silently didn't happen.
    await expect(this.page).toHaveURL('/', { timeout: 15_000 });
  }

  errorMessage() {
    return this.page.getByText('Invalid email or password.');
  }
}
