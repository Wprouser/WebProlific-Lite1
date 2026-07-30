import { test, expect } from '../fixtures';
import { E2E_CATEGORY_NAME, E2E_UNIT_LABEL } from '../seed-data';

test.describe('Item Master (FR-01)', () => {
  test('creates an item, sees it in the list, and opens its detail page', async ({ itemsPage, authenticatedPage: page, uniqueId }) => {
    const name = `E2E Item ${uniqueId}`;
    const sku = `E2E-${uniqueId}`;

    await itemsPage.goto();
    await itemsPage.openCreateForm();
    await itemsPage.fillAndSave({
      name,
      sku,
      categoryName: E2E_CATEGORY_NAME,
      unitLabel: E2E_UNIT_LABEL,
      minStock: '5',
      maxStock: '50',
      costPrice: '12.50',
    });

    await itemsPage.search(sku);
    await expect(itemsPage.row(name)).toBeVisible();

    await itemsPage.openItem(name);
    await expect(page).toHaveURL(/\/items\/[\w-]+$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  });

  test('edits an existing item and the new values show on the list', async ({ itemsPage, uniqueId }) => {
    const name = `E2E Editable ${uniqueId}`;
    const sku = `E2E-EDIT-${uniqueId}`;

    await itemsPage.goto();
    await itemsPage.openCreateForm();
    await itemsPage.fillAndSave({
      name,
      sku,
      categoryName: E2E_CATEGORY_NAME,
      unitLabel: E2E_UNIT_LABEL,
      minStock: '5',
      maxStock: '50',
      costPrice: '12.50',
    });

    await itemsPage.search(sku);
    await itemsPage.openItem(name);

    await itemsPage.page.getByRole('button', { name: 'Edit' }).click();
    const modal = itemsPage.page.getByRole('dialog');
    await modal.getByLabel('Cost price').fill('19.99');
    const response = itemsPage.page.waitForResponse(
      (res) => res.url().includes('/api/v1/items/') && res.request().method() === 'PATCH',
    );
    await modal.getByRole('button', { name: 'Save item' }).click();
    await response;
    await expect(modal).toBeHidden();

    await expect(itemsPage.page.getByText('19.99')).toBeVisible();
  });

  test('blocks saving when min stock is not less than max stock', async ({ itemsPage, uniqueId }) => {
    await itemsPage.goto();
    await itemsPage.openCreateForm();
    const modal = itemsPage.page.getByRole('dialog');
    await modal.getByLabel('Name').fill(`E2E Invalid ${uniqueId}`);
    await modal.getByLabel('Category').selectOption({ label: E2E_CATEGORY_NAME });
    await modal.getByLabel('SKU').fill(`E2E-INVALID-${uniqueId}`);
    await modal.getByLabel(/^Unit/).selectOption({ label: E2E_UNIT_LABEL });
    await modal.getByLabel('Min stock').fill('50');
    await modal.getByLabel('Max stock').fill('5');
    await modal.getByLabel('Cost price').fill('1.00');
    await modal.getByRole('button', { name: 'Save item' }).click();

    await expect(modal.getByText('Min stock must be less than max stock')).toBeVisible();
    // Client-side validation only — the modal must still be open, nothing was saved.
    await expect(modal).toBeVisible();
  });
});
