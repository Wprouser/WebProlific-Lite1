import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PurchaseOrderDetail } from './PurchaseOrderDetail';
import { purchaseOrdersApi, type ApiPurchaseOrder } from '@/lib/purchase-orders-api';
import { suppliersApi } from '@/lib/suppliers-api';
import { itemsApi } from '@/lib/items-api';
import { setSession } from '@/lib/auth-store';

vi.mock('@/lib/purchase-orders-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/purchase-orders-api')>('@/lib/purchase-orders-api');
  return {
    ...actual,
    purchaseOrdersApi: {
      ...actual.purchaseOrdersApi,
      get: vi.fn(),
      submit: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      getPdf: vi.fn(),
      sendEmail: vi.fn(),
    },
  };
});
vi.mock('@/lib/suppliers-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suppliers-api')>('@/lib/suppliers-api');
  return { ...actual, suppliersApi: { ...actual.suppliersApi, get: vi.fn() } };
});
vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return { ...actual, itemsApi: { ...actual.itemsApi, list: vi.fn() } };
});
vi.mock('@/lib/pdf-utils', () => ({ openPdfBlob: vi.fn() }));

const basePO: ApiPurchaseOrder = {
  id: 'po1',
  outletId: 'o1',
  supplierId: 's1',
  status: 'DRAFT',
  expectedDeliveryDate: null,
  createdById: 'u1',
  approvedById: null,
  approvedAt: null,
  currencyCode: 'SAR',
  exchangeRateToBase: '1',
  isTaxInclusive: false,
  discountAmount: '0.00',
  otherChargesAmount: '0.00',
  subtotal: '100.00',
  taxAmount: '15.00',
  totalValue: '115.00',
  lines: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastEmailedAt: null,
  lastEmailedTo: null,
};

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/purchase-orders/po1']}>
      <Routes>
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setRole(role: string) {
  setSession({
    accessToken: 'token',
    refreshToken: 'refresh-token',
    user: { id: 'u1', email: 'test@example.com', preferredLanguage: 'en', effectiveRole: role, effectiveOutletIds: ['o1'] },
  });
}

describe('PurchaseOrderDetail screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (suppliersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', name: 'Al-Fahad Trading' });
    (itemsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    setRole('OUTLET_MANAGER');
  });

  it('DRAFT: shows Edit and Submit for a creator role', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'DRAFT' });
    renderScreen();

    expect(await screen.findByText('Al-Fahad Trading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('PENDING_APPROVAL: shows Approve/Reject for an approval-tier role, not for STORE_STAFF', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'PENDING_APPROVAL' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('PENDING_APPROVAL: STORE_STAFF sees no approve/reject actions', async () => {
    setRole('STORE_STAFF');
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'PENDING_APPROVAL' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('rejecting requires a reason before the confirm button is enabled', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'PENDING_APPROVAL' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirmButton = screen.getByRole('button', { name: 'Confirm Rejection' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'Prices too high');
    expect(confirmButton).not.toBeDisabled();

    (purchaseOrdersApi.reject as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'REJECTED' });
    await userEvent.click(confirmButton);
    expect(purchaseOrdersApi.reject).toHaveBeenCalledWith('po1', 'Prices too high');
  });

  it('APPROVED: shows Send to Supplier', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'APPROVED' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(screen.getByRole('button', { name: 'Send to Supplier' })).toBeInTheDocument();
  });

  it('CLOSED: shows no lifecycle action buttons', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'CLOSED' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to Supplier' })).not.toBeInTheDocument();
  });

  it('AC: Print and Email actions are available regardless of PO status', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...basePO, status: 'CLOSED' });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
  });

  it('Print downloads/opens the real generated PDF', async () => {
    const { openPdfBlob } = await import('@/lib/pdf-utils');
    const blob = new Blob(['%PDF-fake'], { type: 'application/pdf' });
    (purchaseOrdersApi.getPdf as ReturnType<typeof vi.fn>).mockResolvedValue(blob);
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(basePO);
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    await vi.waitFor(() => expect(purchaseOrdersApi.getPdf).toHaveBeenCalledWith('po1'));
    expect(openPdfBlob).toHaveBeenCalledWith(blob);
  });

  it('AC: emailing a DRAFT PO shows a confirmation prompt, and a successful send updates the Last Sent display', async () => {
    (purchaseOrdersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(basePO);
    (suppliersApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      name: 'Al-Fahad Trading',
      email: 'supplier@example.com',
    });
    (purchaseOrdersApi.sendEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePO,
      lastEmailedAt: '2026-07-21T15:40:00.000Z',
      lastEmailedTo: 'supplier@example.com',
    });
    renderScreen();
    await screen.findByText('Al-Fahad Trading');

    await userEvent.click(screen.getByRole('button', { name: 'Email' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText(/hasn't been approved yet/)).toBeInTheDocument();
    expect(purchaseOrdersApi.sendEmail).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Send Anyway' }));
    await vi.waitFor(() => expect(purchaseOrdersApi.sendEmail).toHaveBeenCalledWith('po1', expect.anything()));
    expect(await screen.findByText(/supplier@example\.com/)).toBeInTheDocument();
  });
});
