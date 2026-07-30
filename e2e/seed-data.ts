// Static fixture identifiers shared between global-setup (which seeds the
// dedicated e2e database) and specs/page objects (which log in and select
// these by name). No generated IDs need to round-trip through a file here —
// everything a spec needs to reference is a fixed, human-readable string.

export const E2E_USER = {
  email: 'e2e-owner@example.com',
  password: 'E2eTestPassw0rd!123',
};

export const E2E_CHAIN_NAME = 'E2E Test Group';
export const E2E_PROPERTY_NAME = 'E2E Test Property';
export const E2E_OUTLET_NAME = 'E2E Test Outlet';

// Seeded so the item-create form's Category/Unit selects are never empty —
// ItemFormModal defaults to categories[0]/units[0] when creating.
export const E2E_CATEGORY_NAME = 'Beverages';
export const E2E_UNIT = { name: 'Kilogram', abbreviation: 'kg' };
export const E2E_UNIT_LABEL = `${E2E_UNIT.name} (${E2E_UNIT.abbreviation})`;
