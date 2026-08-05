import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MenuItems } from './MenuItems';
import { menuItemsApi, type ApiMenuItem } from '@/lib/menu-items-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/menu-items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/menu-items-api')>('@/lib/menu-items-api');
  return { ...actual, menuItemsApi: { ...actual.menuItemsApi, list: vi.fn(), create: vi.fn() } };
});

function menuItem(overrides: Partial<ApiMenuItem> = {}): ApiMenuItem {
  return {
    id: 'm1',
    outletId: 'o1',
    name: 'Chicken Biryani',
    isActive: true,
    currentVersion: 1,
    needsYield: false,
    costUsesLegacyRecipe: false,
    totalCost: '12.50',
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <MenuItems />
    </MemoryRouter>,
  );
}

describe('MenuItems screen', () => {
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
  });

  it('lists menu items with status, current recipe version and cost', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([menuItem()]);
    renderScreen();

    expect(await screen.findByRole('cell', { name: 'Chicken Biryani' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Version 1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12.50' })).toBeInTheDocument();
    // Costs are a per-row tree resolution server-side, so the screen has to
    // ask for them explicitly.
    expect(menuItemsApi.list).toHaveBeenCalledWith(expect.objectContaining({ includeCost: true }));
  });

  it('shows a menu item that has no recipe as such, rather than as version 0', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      menuItem({ currentVersion: null, totalCost: null, isActive: false }),
    ]);
    renderScreen();

    expect(await screen.findByRole('cell', { name: 'No recipe' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('distinguishes the recipe needing a yield from the dish whose cost it softens', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      menuItem({ id: 'm-sauce', name: 'House Sauce', needsYield: true }),
      menuItem({ id: 'm-dish', name: 'Biryani', costUsesLegacyRecipe: true }),
    ]);
    renderScreen();

    const sauceRow = (await screen.findByRole('cell', { name: 'House Sauce' })).closest('tr')!;
    const dishRow = screen.getByRole('cell', { name: 'Biryani' }).closest('tr')!;

    // The fix lives on the sauce...
    expect(within(sauceRow).getByText('Needs yield')).toBeInTheDocument();
    expect(within(sauceRow).queryByText('Cost approximate')).not.toBeInTheDocument();
    // ...the dish only inherits the imprecision.
    expect(within(dishRow).getByText('Cost approximate')).toBeInTheDocument();
    expect(within(dishRow).queryByText('Needs yield')).not.toBeInTheDocument();
  });

  it('creates a menu item and goes straight to its builder', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (menuItemsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(menuItem({ id: 'new-1' }));
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'New Menu Item' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Lamb Mandi');
    await userEvent.click(screen.getByRole('button', { name: 'Create and build recipe' }));

    expect(menuItemsApi.create).toHaveBeenCalledWith({ outletId: 'o1', name: 'Lamb Mandi' });
    // A menu item with no recipe is unsellable, so stopping at "created"
    // would leave the user half-done.
    expect(navigateMock).toHaveBeenCalledWith('/menu-items/new-1');
  });

  it('AC: shows a "Needs yield" badge on a menu item whose recipe has no yield', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      menuItem({ id: 'm2', name: 'House Sauce', needsYield: true }),
    ]);
    renderScreen();

    expect(await screen.findByText('Needs yield')).toBeInTheDocument();
  });

  it('summarizes how many recipes need a yield, so the worklist is visible at a glance', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      menuItem({ id: 'm1', name: 'Sauce A', needsYield: true }),
      menuItem({ id: 'm2', name: 'Sauce B', needsYield: true }),
      menuItem({ id: 'm3', name: 'Biryani' }),
    ]);
    renderScreen();

    expect(await screen.findByText(/Recipes used as a sub-recipe with no yield set: 2/)).toBeInTheDocument();
  });

  it('does not badge a menu item whose recipes are all fine', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([menuItem()]);
    renderScreen();

    await screen.findByRole('cell', { name: 'Chicken Biryani' });
    expect(screen.queryByText('Needs yield')).not.toBeInTheDocument();
  });

  it('opens the detail screen when a row is clicked', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([menuItem()]);
    renderScreen();

    const cell = await screen.findByRole('cell', { name: 'Chicken Biryani' });
    await userEvent.click(cell.closest('tr')!);
    expect(navigateMock).toHaveBeenCalledWith('/menu-items/m1');
  });

  it('shows an empty state when there are no menu items', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No menu items yet')).toBeInTheDocument();
  });
});
