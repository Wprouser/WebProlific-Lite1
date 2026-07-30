import { expect, type Page } from '@playwright/test';

/** The app chrome (header/sidebar) that's present on every authenticated screen. */
export class AppShellPage {
  constructor(private readonly page: Page) {}

  async logout(userEmail: string): Promise<void> {
    // UserMenu is rendered more than once at once (sidebar/tablet-header/
    // mobile-drawer variants — see that component's own doc comment), and
    // more than one can report as Playwright-":visible" simultaneously at
    // the default desktop viewport (a collapsed-width flex sibling isn't
    // display:none) — so scope to the sidebar's `complementary` landmark
    // specifically, rather than trying to filter by visibility.
    await this.page
      .getByRole('complementary')
      .getByRole('button', { name: new RegExp(userEmail) })
      .click();
    await this.page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(this.page).toHaveURL(/\/login$/);
  }
}
