import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CloneItemDialog } from './CloneItemDialog';
import { itemsApi, type ApiItem } from '@/lib/items-api';

vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, clone: vi.fn() },
  };
});

const item: ApiItem = {
  id: 'i1',
  outletId: 'o1',
  name: 'Basmati Rice',
  categoryId: 'c1',
  sku: 'RICE-BAS-001',
  barcode: null,
  unit: 'KG',
  minStock: '10',
  maxStock: '100',
  currentStock: '25',
  shelfLifeDays: null,
  costPrice: '85.50',
  defaultSupplierId: null,
  purchaseGLAccount: null,
  defaultTaxRateId: null,
  storageLocation: null,
  isActive: true,
};

describe('CloneItemDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: submitting a new SKU calls itemsApi.clone and reports the clone back via onCloned', async () => {
    const clone = { ...item, id: 'i2', sku: 'RICE-BAS-002', name: 'Basmati Rice (Copy)' };
    (itemsApi.clone as ReturnType<typeof vi.fn>).mockResolvedValue(clone);
    const onCloned = vi.fn();

    render(<CloneItemDialog open item={item} onOpenChange={vi.fn()} onCloned={onCloned} />);
    await userEvent.type(screen.getByPlaceholderText('e.g. RICE-BAS-002'), 'RICE-BAS-002');
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));

    expect(itemsApi.clone).toHaveBeenCalledWith('i1', 'RICE-BAS-002');
    expect(onCloned).toHaveBeenCalledWith(clone);
  });

  it('shows the server error message when cloning fails (e.g. duplicate sku)', async () => {
    const { ApiError } = await import('@/lib/api-client');
    (itemsApi.clone as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(409, 'An item with this SKU already exists'),
    );

    render(<CloneItemDialog open item={item} onOpenChange={vi.fn()} onCloned={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('e.g. RICE-BAS-002'), 'RICE-BAS-001');
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));

    expect(await screen.findByText('An item with this SKU already exists')).toBeInTheDocument();
  });

  it('the clone button is disabled until a SKU is entered', () => {
    render(<CloneItemDialog open item={item} onOpenChange={vi.fn()} onCloned={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
  });
});
