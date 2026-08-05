import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Sales } from './Sales';
import { salesApi, type ApiSale, type ApiUnmappedMenuItem } from '@/lib/sales-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/sales-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sales-api')>('@/lib/sales-api');
  return { ...actual, salesApi: { ...actual.salesApi, list: vi.fn(), listUnmapped: vi.fn() } };
});

function sale(overrides: Partial<ApiSale> = {}): ApiSale {
  return {
    id: 's1',
    outletId: 'o1',
    menuItemId: 'm1',
    menuItemName: 'Chicken Biryani',
    quantitySold: '2.000',
    recipeVersionUsed: 1,
    posReferenceId: 'pos-1',
    sourceType: 'WEBHOOK',
    importBatchId: null,
    isVoid: false,
    voidedAt: null,
    saleTimestamp: '2026-07-20T12:34:00.000Z',
    createdAt: '2026-07-20T12:34:01.000Z',
    ...overrides,
  };
}

const unmappedRow: ApiUnmappedMenuItem = {
  menuItemId: 'm9',
  menuItemName: 'Mystery Special',
  outletId: 'o1',
  saleCount: 5,
  totalQuantitySold: '12.000',
  lastSoldAt: '2026-07-20T12:34:00.000Z',
};

function renderScreen(initialEntry = '/sales') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Sales />
    </MemoryRouter>,
  );
}

describe('Sales screen', () => {
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
    (salesApi.listUnmapped as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('lists sales with a source badge and the recipe version used', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sale()]);
    renderScreen();

    const cell = await screen.findByRole('cell', { name: 'Chicken Biryani' });
    // Scoped to the row: the source filter's <option> list carries the same
    // labels, so a bare getByText would match two nodes.
    const row = within(cell.closest('tr')!);
    expect(row.getByText('Webhook')).toBeInTheDocument();
    expect(row.getByText('Version 1')).toBeInTheDocument();
  });

  it('marks a sale that deducted nothing, so it reads differently from a normal one', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      sale({ recipeVersionUsed: null, sourceType: 'BATCH_IMPORT' }),
    ]);
    renderScreen();

    const cell = await screen.findByRole('cell', { name: 'Chicken Biryani' });
    const row = within(cell.closest('tr')!);
    expect(row.getByText('Not deducted')).toBeInTheDocument();
    expect(row.getByText('Batch Import')).toBeInTheDocument();
  });

  it('marks a voided sale', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sale({ isVoid: true })]);
    renderScreen();
    expect(await screen.findByText('Voided')).toBeInTheDocument();
  });

  it('AC: the Unmapped Items worklist lists sold-but-unmapped items, each linking to its menu item', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (salesApi.listUnmapped as ReturnType<typeof vi.fn>).mockResolvedValue([unmappedRow]);
    renderScreen('/sales?tab=unmapped');

    expect(await screen.findByRole('cell', { name: 'Mystery Special' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '5' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a recipe' })).toHaveAttribute('href', '/menu-items/m9');
  });

  it('shows the unmapped count on the tab without having to open it', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sale()]);
    (salesApi.listUnmapped as ReturnType<typeof vi.fn>).mockResolvedValue([unmappedRow]);
    renderScreen();

    const tab = await screen.findByRole('button', { name: /Unmapped Items/ });
    expect(tab).toHaveTextContent('1');
  });

  it('starts the batch import flow from the header action', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Import Daily Sales' }));
    expect(navigateMock).toHaveBeenCalledWith('/sales/import');
  });

  it('filters by source', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([sale()]);
    renderScreen();
    await screen.findByRole('cell', { name: 'Chicken Biryani' });

    await userEvent.selectOptions(screen.getByRole('combobox'), 'MANUAL');
    expect(salesApi.list).toHaveBeenLastCalledWith({ outletId: 'o1', sourceType: 'MANUAL' });
  });

  it('shows an empty worklist state when nothing is unmapped', async () => {
    (salesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderScreen('/sales?tab=unmapped');
    expect(await screen.findByText('Nothing unmapped')).toBeInTheDocument();
  });
});
