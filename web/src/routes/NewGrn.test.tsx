import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NewGrn } from './NewGrn';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderScreen(initialEntry = '/grn/new') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <NewGrn />
    </MemoryRouter>,
  );
}

describe('NewGrn chooser', () => {
  it('AC: presents Against-a-PO and Direct Entry as working options, Scan Invoice as a disabled Coming Soon card', () => {
    renderScreen();
    expect(screen.getByText('Against a Purchase Order')).toBeInTheDocument();
    expect(screen.getByText('Direct Entry (No PO)')).toBeInTheDocument();
    expect(screen.getByText('Scan Invoice')).toBeInTheDocument();
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
  });

  it('navigates to the PO picker when no poId is pre-selected', async () => {
    renderScreen();
    await userEvent.click(screen.getByText('Against a Purchase Order'));
    expect(navigateMock).toHaveBeenCalledWith('/grn/new/po');
  });

  it('AC: pre-selects the Against-a-PO flow with that PO chosen when arriving with a poId', async () => {
    renderScreen('/grn/new?poId=po-42');
    await userEvent.click(screen.getByText('Against a Purchase Order'));
    expect(navigateMock).toHaveBeenCalledWith('/grn/new/po/po-42');
  });

  it('navigates to the direct-entry form', async () => {
    renderScreen();
    await userEvent.click(screen.getByText('Direct Entry (No PO)'));
    expect(navigateMock).toHaveBeenCalledWith('/grn/new/direct');
  });

  it('AC: Scan Invoice is disabled and does not navigate when clicked', async () => {
    renderScreen();
    await userEvent.click(screen.getByText('Scan Invoice'));
    expect(navigateMock).not.toHaveBeenCalledWith('/grn/new/scan');
  });
});
