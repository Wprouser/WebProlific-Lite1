import { render, screen } from '@testing-library/react';
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
  return { ...actual, menuItemsApi: { ...actual.menuItemsApi, list: vi.fn() } };
});

function menuItem(overrides: Partial<ApiMenuItem> = {}): ApiMenuItem {
  return { id: 'm1', outletId: 'o1', name: 'Chicken Biryani', isActive: true, needsYield: false, ...overrides };
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

  it('lists menu items with their active status', async () => {
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([menuItem()]);
    renderScreen();

    expect(await screen.findByRole('cell', { name: 'Chicken Biryani' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
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
