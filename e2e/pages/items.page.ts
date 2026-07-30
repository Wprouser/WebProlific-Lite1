import { expect, type Page } from '@playwright/test';

export interface NewItemInput {
  name: string;
  sku: string;
  categoryName: string;
  unitLabel: string;
  minStock: string;
  maxStock: string;
  costPrice: string;
}

export class ItemsPage {
  // Public so specs can reach in for one-off assertions/interactions this
  // page object doesn't wrap (e.g. the Item Detail screen's Edit button) —
  // the wrapped methods below cover the repeated, race-prone actions.
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/items', { waitUntil: 'networkidle' });
  }

  async search(term: string): Promise<void> {
    await this.page.getByPlaceholder('Search by name or SKU…').fill(term);
    // The list re-fetches on a 300ms debounce (see Items.tsx) — wait for
    // that request rather than an arbitrary timeout.
    await this.page.waitForResponse((res) => res.url().includes('/api/v1/items') && res.ok());
  }

  async openCreateForm(): Promise<void> {
    // Two "Add item" buttons can exist at once: the toolbar's (always
    // present) and the empty-state's (only when the list has zero rows) —
    // the toolbar one is first in DOM order regardless of list state.
    await this.page.getByRole('button', { name: 'Add item' }).first().click();
    await expect(this.page.getByRole('dialog')).toBeVisible();
  }

  async fillAndSave(input: NewItemInput): Promise<void> {
    const modal = this.page.getByRole('dialog');
    // No `exact: true` here — every required field's <label> wraps a
    // visually-hidden-but-not-accname-hidden "*" marker (aria-hidden on the
    // span doesn't stop Chromium including it in the computed accessible
    // name), so the real name is e.g. "Name*", not "Name". Substring
    // matching is what actually works — see the skill's own note on this
    // exact trap.
    await modal.getByLabel('Name').fill(input.name);
    await modal.getByLabel('Category').selectOption({ label: input.categoryName });
    await modal.getByLabel('SKU').fill(input.sku);
    // Neither loose nor exact matching works for "Unit" alone: a <select>'s
    // computed accessible name here is the label text *plus* the currently
    // selected option's text concatenated with no separator (e.g.
    // "UnitKilogram (kg)"), so exact:true never matches, and a plain
    // substring match also catches "Rate per unit" (the opening-stock
    // field). Anchor to the start instead — only the real Unit field's
    // name (with or without a selected-option suffix) begins with "Unit".
    await modal.getByLabel(/^Unit/).selectOption({ label: input.unitLabel });
    await modal.getByLabel('Min stock').fill(input.minStock);
    await modal.getByLabel('Max stock').fill(input.maxStock);
    await modal.getByLabel('Cost price').fill(input.costPrice);

    // Click-then-close race: the modal's onSaved handler only fires (closing
    // it and refetching the list) once the POST actually resolves — wait for
    // that response rather than just the click, or a fast run can move on
    // before the item actually exists server-side.
    const response = this.page.waitForResponse(
      (res) => res.url().includes('/api/v1/items') && res.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: 'Save item' }).click();
    await response;
    await expect(modal).toBeHidden();
  }

  row(itemName: string) {
    return this.page.getByRole('row', { name: new RegExp(itemName) });
  }

  async openItem(name: string): Promise<void> {
    await this.page.getByRole('button', { name, exact: true }).click();
  }
}
