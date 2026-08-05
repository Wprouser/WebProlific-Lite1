import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SalesImportUpload } from './SalesImportUpload';
import { salesApi } from '@/lib/sales-api';
import { setSession } from '@/lib/auth-store';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/sales-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sales-api')>('@/lib/sales-api');
  return { ...actual, salesApi: { ...actual.salesApi, uploadBatch: vi.fn() } };
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <SalesImportUpload />
    </MemoryRouter>,
  );
}

function csvFile() {
  return new File(['Menu Item,Qty,Date\nChicken Biryani,1,03/04/2026'], 'daily.csv', { type: 'text/csv' });
}

describe('SalesImportUpload screen', () => {
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
    (salesApi.uploadBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      batch: { id: 'b1' },
      skippedLines: [],
    });
  });

  it('offers the three date formats, defaulting to day-first', () => {
    renderScreen();
    const select = screen.getByLabelText('Date format used in this file') as HTMLSelectElement;

    expect(select.value).toBe('DD/MM/YYYY');
    expect([...select.options].map((option) => option.value)).toEqual([
      'DD/MM/YYYY',
      'MM/DD/YYYY',
      'YYYY-MM-DD',
    ]);
  });

  it('uploads with the default format when the user does not change it', async () => {
    renderScreen();
    await userEvent.upload(screen.getByLabelText('Sales export file (CSV or Excel)'), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload and review' }));

    expect(salesApi.uploadBatch).toHaveBeenCalledWith('o1', expect.any(File), 'DD/MM/YYYY');
  });

  it('sends the chosen format, so an American export is not mis-dated', async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText('Date format used in this file'), 'MM/DD/YYYY');
    await userEvent.upload(screen.getByLabelText('Sales export file (CSV or Excel)'), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload and review' }));

    expect(salesApi.uploadBatch).toHaveBeenCalledWith('o1', expect.any(File), 'MM/DD/YYYY');
    expect(navigateMock).toHaveBeenCalledWith('/sales/import/b1', expect.anything());
  });

  it('cannot be submitted without a file', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: 'Upload and review' })).toBeDisabled();
  });

  it('shows the server\'s reason when the file cannot be read', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
    (salesApi.uploadBatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, 'Could not find a sale-date column in the header row.'),
    );
    renderScreen();

    await userEvent.upload(screen.getByLabelText('Sales export file (CSV or Excel)'), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload and review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not find a sale-date column');
  });
});
