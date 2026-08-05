import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MenuItemDetail } from './MenuItemDetail';
import { menuItemsApi, type ApiMenuItem, type ApiRecipe } from '@/lib/menu-items-api';
import { itemsApi, unitsApi } from '@/lib/items-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/menu-items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/menu-items-api')>('@/lib/menu-items-api');
  return {
    ...actual,
    menuItemsApi: {
      ...actual.menuItemsApi,
      get: vi.fn(),
      currentRecipe: vi.fn(),
      recipeHistory: vi.fn(),
      cost: vi.fn(),
      usedIn: vi.fn(),
      subRecipeCandidates: vi.fn(),
      saveRecipe: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    },
  };
});
vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, list: vi.fn() },
    unitsApi: { ...actual.unitsApi, list: vi.fn() },
  };
});

const KG = { id: 'kg', outletId: 'o1', name: 'Kilogram', abbreviation: 'kg', baseUnitId: null, conversionFactor: null };
const G = { id: 'g', outletId: 'o1', name: 'Gram', abbreviation: 'g', baseUnitId: 'kg', conversionFactor: '0.001' };
const LITRE = { id: 'l', outletId: 'o1', name: 'Litre', abbreviation: 'L', baseUnitId: null, conversionFactor: null };

const RICE = { id: 'rice', outletId: 'o1', name: 'Basmati Rice', unitId: 'kg', costPrice: '10.00' };

function menuItem(overrides: Partial<ApiMenuItem> = {}): ApiMenuItem {
  return {
    id: 'm1',
    outletId: 'o1',
    name: 'Chicken Biryani',
    isActive: false,
    currentVersion: 2,
    needsYield: false,
    costUsesLegacyRecipe: false,
    totalCost: '12.50',
    ...overrides,
  };
}

function recipe(overrides: Partial<ApiRecipe> = {}): ApiRecipe {
  return {
    id: 'r2',
    menuItemId: 'm1',
    version: 2,
    isCurrent: true,
    yieldQuantity: null,
    yieldUnitId: null,
    lines: [
      { id: 'l1', recipeId: 'r2', itemId: 'rice', subRecipeId: null, quantity: '0.25', quantityUnitId: null },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SAUCE_CANDIDATE = {
  menuItemId: 'm2',
  menuItemName: 'House Sauce',
  recipeId: 'r-sauce',
  version: 1,
  yieldQuantity: '2',
  yieldUnitId: 'kg',
};

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/menu-items/m1']}>
      <Routes>
        <Route path="/menu-items/:id" element={<MenuItemDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('MenuItemDetail — Recipe builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: {
        id: 'u1',
        email: 'test@example.com',
        preferredLanguage: 'en',
        effectiveRole: 'OUTLET_MANAGER',
        effectiveOutletIds: ['o1'],
      },
    });
    asMock(menuItemsApi.get).mockResolvedValue(menuItem());
    asMock(menuItemsApi.currentRecipe).mockResolvedValue(recipe());
    asMock(menuItemsApi.recipeHistory).mockResolvedValue([recipe()]);
    asMock(menuItemsApi.cost).mockResolvedValue({
      menuItemId: 'm1',
      recipeId: 'r2',
      recipeVersion: 2,
      totalCost: '2.50',
      components: [],
      usesLegacyBatchMultiplier: false,
      legacyRecipeIds: [],
    });
    asMock(menuItemsApi.usedIn).mockResolvedValue([]);
    asMock(menuItemsApi.subRecipeCandidates).mockResolvedValue([SAUCE_CANDIDATE]);
    asMock(menuItemsApi.saveRecipe).mockResolvedValue(recipe({ version: 3 }));
    asMock(itemsApi.list).mockResolvedValue([RICE]);
    asMock(unitsApi.list).mockResolvedValue([KG, G, LITRE]);
  });

  it('seeds the builder from the current version, since saving submits the whole recipe', async () => {
    renderScreen();
    expect(await screen.findByLabelText('Quantity for line 1')).toHaveValue('0.25');
    expect(screen.getByLabelText('Ingredient for line 1')).toHaveValue('rice');
  });

  it('AC: says which version saving will create, rather than overwriting silently', async () => {
    renderScreen();
    // Current is v2, so the button and the note both name v3.
    expect(await screen.findByRole('button', { name: 'Save as Version 3' })).toBeInTheDocument();
    expect(screen.getByText(/Saving creates Version 3/)).toBeInTheDocument();
  });

  it('AC: the sub-recipe picker offers only yield-bearing recipes', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.selectOptions(screen.getByLabelText('Line 1 type'), 'SUB_RECIPE');
    const picker = screen.getByLabelText('Sub-recipe for line 1');

    // The screen never sees a yield-less recipe: the server only returns
    // candidates, so the 409 case can't be selected.
    expect(menuItemsApi.subRecipeCandidates).toHaveBeenCalledWith('o1', 'm1');
    expect([...(picker as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'r-sauce']);
    expect(within(picker).getByRole('option', { name: /House Sauce/ })).toHaveTextContent('Yields 2 kg');
  });

  it('offers only units sharing a base with the chosen sub-recipe\'s yield unit', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.selectOptions(screen.getByLabelText('Line 1 type'), 'SUB_RECIPE');
    await userEvent.selectOptions(screen.getByLabelText('Sub-recipe for line 1'), 'r-sauce');

    const unitPicker = screen.getByLabelText('Unit for line 1') as HTMLSelectElement;
    // kg and g share a base; litre is an unrelated family and would 400.
    expect([...unitPicker.options].map((o) => o.value)).toEqual(['', 'kg', 'g']);
  });

  it('submits itemId for a raw line and subRecipeId for a sub-recipe line, never both', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.selectOptions(screen.getByLabelText('Line 1 type'), 'SUB_RECIPE');
    await userEvent.selectOptions(screen.getByLabelText('Sub-recipe for line 1'), 'r-sauce');
    await userEvent.selectOptions(screen.getByLabelText('Unit for line 1'), 'kg');
    // Cleared first: switching a line's type deliberately keeps whatever
    // quantity was already typed, so typing here would append to it.
    await userEvent.clear(screen.getByLabelText('Quantity for line 1'));
    await userEvent.type(screen.getByLabelText('Quantity for line 1'), '0.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));

    expect(menuItemsApi.saveRecipe).toHaveBeenCalledWith('m1', {
      yieldQuantity: undefined,
      yieldUnitId: undefined,
      basedOnVersion: 2,
      lines: [{ subRecipeId: 'r-sauce', quantity: '0.5', quantityUnitId: 'kg' }],
    });
  });

  it('sends the yield when one is entered', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.type(screen.getByLabelText('Yield quantity'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Yield unit'), 'kg');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));

    expect(menuItemsApi.saveRecipe).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ yieldQuantity: '2', yieldUnitId: 'kg' }),
    );
  });

  it('previews a raw line\'s cost from the item price', async () => {
    renderScreen();
    const quantity = await screen.findByLabelText('Quantity for line 1');
    // 0.25 kg x 10.00 — asserted within the line's own row, since the header
    // badge shows the server's (equal) figure for the saved version too.
    expect(within(quantity.closest('div')!.parentElement!).getByText('2.50')).toBeInTheDocument();
    expect(screen.getByText(/Estimated cost: 2.50/)).toBeInTheDocument();
  });

  it('leaves a sub-recipe line unpriced when its unit needs a server-side conversion', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.selectOptions(screen.getByLabelText('Line 1 type'), 'SUB_RECIPE');
    await userEvent.selectOptions(screen.getByLabelText('Sub-recipe for line 1'), 'r-sauce');
    // Grams, where the sauce yields kilograms: the browser has no conversion
    // table, so it shows nothing rather than a wrong number.
    await userEvent.selectOptions(screen.getByLabelText('Unit for line 1'), 'g');

    expect(screen.getByText(/Estimated cost: 0.00/)).toBeInTheDocument();
  });

  it('cannot be saved with no lines', async () => {
    asMock(menuItemsApi.currentRecipe).mockResolvedValue(null);
    asMock(menuItemsApi.get).mockResolvedValue(menuItem({ currentVersion: null }));
    renderScreen();

    expect(await screen.findByRole('button', { name: 'Save as Version 1' })).toBeDisabled();
    expect(screen.getByText('Add at least one ingredient before saving.')).toBeInTheDocument();
  });

  it('sends the version the edit was based on, so a stale save can be rejected', async () => {
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));
    expect(menuItemsApi.saveRecipe).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ basedOnVersion: 2 }),
    );
  });

  it('sends 0 as the base when the menu item has no recipe yet', async () => {
    asMock(menuItemsApi.currentRecipe).mockResolvedValue(null);
    asMock(menuItemsApi.get).mockResolvedValue(menuItem({ currentVersion: null }));
    asMock(itemsApi.list).mockResolvedValue([RICE]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Add line' }));
    await userEvent.selectOptions(screen.getByLabelText('Ingredient for line 1'), 'rice');
    await userEvent.type(screen.getByLabelText('Quantity for line 1'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 1' }));

    expect(menuItemsApi.saveRecipe).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ basedOnVersion: 0 }),
    );
  });

  it('AC: a conflicting save is reported as a conflict, with a way to reload', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    asMock(menuItemsApi.saveRecipe).mockRejectedValue(
      new ApiError(409, 'This recipe has changed since you opened it — it is now at version 3.'),
    );
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('now at version 3');
    // Re-saving would just conflict again — reloading is the only way forward.
    expect(screen.getByRole('button', { name: 'Save as Version 3' })).toBeDisabled();
    // The user's typed work is still on screen to copy from.
    expect(screen.getByText(/Your changes are still on screen/)).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity for line 1')).toHaveValue('0.25');
  });

  it('reloading after a conflict re-seeds the builder from the new current version', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    asMock(menuItemsApi.saveRecipe).mockRejectedValue(new ApiError(409, 'Conflict'));
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));

    // Someone else's version 3 is now current.
    asMock(menuItemsApi.get).mockResolvedValue(menuItem({ currentVersion: 3 }));
    asMock(menuItemsApi.currentRecipe).mockResolvedValue(
      recipe({
        id: 'r3',
        version: 3,
        lines: [
          { id: 'l9', recipeId: 'r3', itemId: 'rice', subRecipeId: null, quantity: '0.75', quantityUnitId: null },
        ],
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Reload recipe' }));

    await waitFor(() => expect(screen.getByLabelText('Quantity for line 1')).toHaveValue('0.75'));
    // The next save now claims version 4 and is unblocked again.
    expect(screen.getByRole('button', { name: 'Save as Version 4' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a non-conflict save failure offers no reload — retrying is the right move there', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    asMock(menuItemsApi.saveRecipe).mockRejectedValue(new ApiError(400, 'quantity must be positive'));
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('quantity must be positive');
    expect(screen.queryByRole('button', { name: 'Reload recipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as Version 3' })).toBeEnabled();
  });

  it('shows the server\'s reason when a save is rejected', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    asMock(menuItemsApi.saveRecipe).mockRejectedValue(
      new ApiError(409, 'Sub-recipe "House Sauce" has no yield set'),
    );
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Version 3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('has no yield set');
  });

  it('blocks activation until a recipe exists, and explains why', async () => {
    asMock(menuItemsApi.currentRecipe).mockResolvedValue(null);
    asMock(menuItemsApi.get).mockResolvedValue(menuItem({ currentVersion: null }));
    renderScreen();

    const button = await screen.findByRole('button', { name: 'Mark sellable' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Add a recipe before this menu item can be sold.');
  });

  it('activates a menu item that has a recipe', async () => {
    asMock(menuItemsApi.activate).mockResolvedValue(menuItem({ isActive: true }));
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark sellable' }));
    expect(menuItemsApi.activate).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark unsellable' })).toBeInTheDocument());
  });

  it('AC: reports parents still pinned to an older version of this recipe', async () => {
    asMock(menuItemsApi.usedIn).mockResolvedValue([
      {
        parentMenuItemId: 'm9',
        parentMenuItemName: 'Biryani',
        parentRecipeId: 'r9',
        parentVersion: 1,
        referencedVersion: 1,
        isStale: true,
      },
    ]);
    renderScreen();

    expect(await screen.findByText(/Recipes still pinned to an older version of this one: 1/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Used In/ }));
    expect(screen.getByRole('link', { name: 'Biryani' })).toHaveAttribute('href', '/menu-items/m9');
    expect(screen.getByText('Older version')).toBeInTheDocument();
  });

  it('says nothing about stale parents when every reference is current', async () => {
    asMock(menuItemsApi.usedIn).mockResolvedValue([
      {
        parentMenuItemId: 'm9',
        parentMenuItemName: 'Biryani',
        parentRecipeId: 'r9',
        parentVersion: 1,
        referencedVersion: 2,
        isStale: false,
      },
    ]);
    renderScreen();

    await screen.findByLabelText('Quantity for line 1');
    expect(screen.queryByText(/still pinned to an older version/)).not.toBeInTheDocument();
  });

  it('shows past versions as read-only history', async () => {
    asMock(menuItemsApi.recipeHistory).mockResolvedValue([
      recipe({ id: 'r2', version: 2, isCurrent: true }),
      recipe({ id: 'r1', version: 1, isCurrent: false, yieldQuantity: '2', yieldUnitId: 'kg' }),
    ]);
    renderScreen();
    await screen.findByLabelText('Quantity for line 1');

    await userEvent.click(screen.getByRole('button', { name: 'Version History' }));
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByText(/Yields 2 kg/)).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });
});
