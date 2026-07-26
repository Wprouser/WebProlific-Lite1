import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanInvoiceGrnForm } from './ScanInvoiceGrnForm';
import { invoiceScansApi, type ApiInvoiceScan } from '@/lib/invoice-scans-api';
import { grnApi } from '@/lib/grn-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { itemsApi } from '@/lib/items-api';
import { taxRatesApi } from '@/lib/tax-rates-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/invoice-scans-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/invoice-scans-api')>('@/lib/invoice-scans-api');
  return { ...actual, invoiceScansApi: { ...actual.invoiceScansApi, upload: vi.fn(), getStatus: vi.fn() } };
});
vi.mock('@/lib/grn-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/grn-api')>('@/lib/grn-api');
  return { ...actual, grnApi: { ...actual.grnApi, createDirect: vi.fn() } };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, list: vi.fn() } };
});
vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return { ...actual, itemsApi: { ...actual.itemsApi, list: vi.fn() } };
});
vi.mock('@/lib/tax-rates-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tax-rates-api')>('@/lib/tax-rates-api');
  return { ...actual, taxRatesApi: { ...actual.taxRatesApi, list: vi.fn() } };
});

const processingScan: ApiInvoiceScan = {
  id: 'scan1',
  outletId: 'o1',
  fileUrl: '/uploads/invoice-scans/inv.jpg',
  status: 'PROCESSING',
  extractedData: null,
  failureReason: null,
  createdById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const extractedScan: ApiInvoiceScan = {
  ...processingScan,
  status: 'EXTRACTED',
  extractedData: {
    invoiceNumber: 'INV-88213',
    supplierNameGuess: 'Al-Fahad Trading',
    matchedSupplierId: 's1',
    lines: [{ itemNameGuess: 'Basmati Rice', quantity: '20', unitPrice: '87.00', matchedItemId: 'i1' }],
  },
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <ScanInvoiceGrnForm />
    </MemoryRouter>,
  );
}

describe('ScanInvoiceGrnForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession({
      accessToken: 'token',
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: 'OUTLET_MANAGER', effectiveOutletIds: ['o1'] },
    });
    (suppliersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', name: 'Al-Fahad Trading', preferredCurrency: 'SAR' },
    ]);
    (itemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'i1', name: 'Basmati Rice', currentStock: '10.000', unit: 'KG' },
    ]);
    (taxRatesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('shows an upload prompt initially', async () => {
    renderScreen();
    expect(await screen.findByText('Upload a photo or PDF of the supplier invoice')).toBeInTheDocument();
  });

  it('AC: extracted data pre-fills the review form, which the user must explicitly confirm', async () => {
    (invoiceScansApi.upload as ReturnType<typeof vi.fn>).mockResolvedValue(processingScan);
    (invoiceScansApi.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue(extractedScan);
    renderScreen();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'invoice.jpg', { type: 'image/jpeg' });
    await userEvent.upload(fileInput, file);

    expect(await screen.findByText('Review and correct every field below before confirming — nothing is saved until you confirm.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('INV-88213')).toBeInTheDocument();

    // Confirming is a separate, explicit action — nothing was created yet.
    expect(grnApi.createDirect).not.toHaveBeenCalled();
  });

  it('confirms into a real GRN via the existing Direct-create endpoint, passing the scan id', async () => {
    (invoiceScansApi.upload as ReturnType<typeof vi.fn>).mockResolvedValue(processingScan);
    (invoiceScansApi.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue(extractedScan);
    (grnApi.createDirect as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'g1' });
    renderScreen();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(['fake-bytes'], 'invoice.jpg', { type: 'image/jpeg' }));
    await screen.findByDisplayValue('INV-88213');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & Create GRN' }));

    await waitFor(() =>
      expect(grnApi.createDirect).toHaveBeenCalledWith(
        expect.objectContaining({ outletId: 'o1', supplierId: 's1', invoiceScanId: 'scan1' }),
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith('/grn/g1');
  });

  it('shows a failed state with a retry action when the scan fails', async () => {
    (invoiceScansApi.upload as ReturnType<typeof vi.fn>).mockResolvedValue(processingScan);
    (invoiceScansApi.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...processingScan,
      status: 'FAILED',
      failureReason: 'blurry image',
    });
    renderScreen();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(['fake-bytes'], 'invoice.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText('blurry image')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try another file' })).toBeInTheDocument();
  });
});
