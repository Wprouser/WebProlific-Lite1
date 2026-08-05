import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SalesImportReview } from './SalesImportReview';
import { salesApi, type ApiBatchReview } from '@/lib/sales-api';
import { menuItemsApi } from '@/lib/menu-items-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/sales-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sales-api')>('@/lib/sales-api');
  return {
    ...actual,
    salesApi: { ...actual.salesApi, reviewBatch: vi.fn(), assignRow: vi.fn(), runBatch: vi.fn() },
  };
});
vi.mock('@/lib/menu-items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/menu-items-api')>('@/lib/menu-items-api');
  return { ...actual, menuItemsApi: { ...actual.menuItemsApi, list: vi.fn() } };
});

function review(overrides: Partial<ApiBatchReview> = {}): ApiBatchReview {
  return {
    batch: {
      id: 'b1',
      outletId: 'o1',
      fileName: 'daily-sales.csv',
      importedById: 'u1',
      status: 'STAGED',
      totalRows: 2,
      processedRows: 0,
      createdAt: '2026-07-20T12:00:00.000Z',
      processedAt: null,
    },
    rows: [
      {
        id: 'r1',
        batchId: 'b1',
        rowNumber: 1,
        rawMenuItemName: 'Chicken Biryani',
        rawSku: null,
        quantitySold: '4.000',
        saleDate: '2026-07-20T00:00:00.000Z',
        posReferenceRaw: null,
        matchedMenuItemId: 'm1',
        matchedMenuItemName: 'Chicken Biryani',
        matchStatus: 'MATCHED',
        saleId: null,
        skipReason: null,
      },
      {
        id: 'r2',
        batchId: 'b1',
        rowNumber: 2,
        rawMenuItemName: 'Mystery Special',
        rawSku: null,
        quantitySold: '2.000',
        saleDate: '2026-07-20T00:00:00.000Z',
        posReferenceRaw: null,
        matchedMenuItemId: null,
        matchedMenuItemName: null,
        matchStatus: 'UNMATCHED',
        saleId: null,
        skipReason: null,
      },
    ],
    matchedCount: 1,
    unmatchedCount: 1,
    projectedImpact: [
      {
        itemId: 'i1',
        itemName: 'Basmati Rice',
        unitId: 'kg',
        quantity: '1',
        currentStock: '100.000',
        projectedStock: '99',
      },
    ],
    unmappedMenuItemIds: [],
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/sales/import/b1']}>
      <Routes>
        <Route path="/sales/import/:batchId" element={<SalesImportReview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SalesImportReview screen', () => {
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
    (menuItemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', outletId: 'o1', name: 'Chicken Biryani', isActive: true, needsYield: false },
      { id: 'm2', outletId: 'o1', name: 'Seasonal Special', isActive: true, needsYield: false },
    ]);
  });

  it('AC: shows the projected ingredient impact before anything is committed', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(review());
    renderScreen();

    expect(await screen.findByText('Basmati Rice')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
    // Nothing has run yet.
    expect(salesApi.runBatch).not.toHaveBeenCalled();
  });

  it('shows matched and unmatched counts', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(review());
    renderScreen();

    expect(await screen.findByText('Matched: 1')).toBeInTheDocument();
    expect(screen.getByText('Unmatched: 1')).toBeInTheDocument();
  });

  it('AC: an unmatched row can be corrected inline, without re-uploading', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(review());
    (salesApi.assignRow as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderScreen();

    const picker = await screen.findByLabelText('Menu item for Mystery Special');
    await userEvent.selectOptions(picker, 'm2');

    expect(salesApi.assignRow).toHaveBeenCalledWith('b1', 'r2', 'm2');
    // The preview is re-fetched, because a corrected match changes it.
    await waitFor(() => expect(salesApi.reviewBatch).toHaveBeenCalledTimes(2));
  });

  it('AC: Run BOM asks for confirmation, showing row count and projected deduction', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(review());
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Run BOM' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Rows to process');
    expect(dialog).toHaveTextContent('Ingredients affected');
    expect(dialog).toHaveTextContent('Rows that will be skipped');
    // Still nothing run until the confirm button is pressed.
    expect(salesApi.runBatch).not.toHaveBeenCalled();
  });

  it('warns in the confirmation when an ingredient would go below zero', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      review({
        projectedImpact: [
          {
            itemId: 'i1',
            itemName: 'Basmati Rice',
            unitId: 'kg',
            quantity: '120',
            currentStock: '100.000',
            projectedStock: '-20',
          },
        ],
      }),
    );
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Run BOM' }));
    expect(await screen.findByText(/Ingredients that will go below zero: 1/)).toBeInTheDocument();
  });

  it('runs the batch on confirmation and reports the outcome', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(review());
    (salesApi.runBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      batch: { ...review().batch, status: 'COMPLETED_WITH_WARNINGS' },
      processedRows: 1,
      skippedRows: 1,
      warnings: [{ action: 'RECIPE_MISSING', message: '"Mystery Special" was sold but has no recipe.' }],
    });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Run BOM' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run BOM' }));

    expect(await screen.findByText(/1 rows processed, 1 skipped/)).toBeInTheDocument();
    expect(screen.getByText(/"Mystery Special" was sold but has no recipe./)).toBeInTheDocument();
  });

  it('does not offer Run BOM again once the batch has been run', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      review({ batch: { ...review().batch, status: 'COMPLETED' } }),
    );
    renderScreen();

    await screen.findByText('Basmati Rice');
    expect(screen.queryByRole('button', { name: 'Run BOM' })).not.toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('flags matched rows whose menu item has no recipe, so the preview is not read as complete', async () => {
    (salesApi.reviewBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      review({ unmappedMenuItemIds: ['m1'] }),
    );
    renderScreen();

    expect(await screen.findByText(/Matched menu items with no recipe: 1/)).toBeInTheDocument();
  });
});
