import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NavList, navItems } from './nav-items';

describe('nav-items', () => {
  it('AC: Tax Configuration is a top-level, enabled nav entry pointing at /tax-rates', () => {
    const taxesItem = navItems.find((item) => item.labelKey === 'taxes');
    expect(taxesItem).toBeDefined();
    expect(taxesItem?.to).toBe('/tax-rates');
  });

  it('AC: renders as a real link (not a "Soon" disabled stub) reachable from the shared nav', () => {
    render(
      <MemoryRouter>
        <NavList />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Taxes' });
    expect(link).toHaveAttribute('href', '/tax-rates');
  });

  it('AC: Currency & Exchange Rates is a top-level, enabled nav entry pointing at /currency', () => {
    const currencyItem = navItems.find((item) => item.labelKey === 'currency');
    expect(currencyItem).toBeDefined();
    expect(currencyItem?.to).toBe('/currency');

    render(
      <MemoryRouter>
        <NavList />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Currency' });
    expect(link).toHaveAttribute('href', '/currency');
  });
});
