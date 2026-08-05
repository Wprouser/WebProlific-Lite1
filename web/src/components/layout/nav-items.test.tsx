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

  it('AC: Suppliers is now a real, enabled nav entry (no longer the "Soon" stub)', () => {
    const suppliersItem = navItems.find((item) => item.labelKey === 'suppliers');
    expect(suppliersItem).toBeDefined();
    expect(suppliersItem?.to).toBe('/suppliers');

    render(
      <MemoryRouter>
        <NavList />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Suppliers' });
    expect(link).toHaveAttribute('href', '/suppliers');
  });

  it('AC (FR-06): Sales is a top-level nav entry, reachable without going through another screen', () => {
    const salesItem = navItems.find((item) => item.labelKey === 'sales');
    expect(salesItem).toBeDefined();
    expect(salesItem?.to).toBe('/sales');

    render(
      <MemoryRouter>
        <NavList />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Sales' })).toHaveAttribute('href', '/sales');
  });

  it('AC (FR-06): Menu Items is reachable too — the Unmapped worklist links into it', () => {
    const menuItemsItem = navItems.find((item) => item.labelKey === 'menuItems');
    expect(menuItemsItem?.to).toBe('/menu-items');

    render(
      <MemoryRouter>
        <NavList />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Menu Items' })).toHaveAttribute('href', '/menu-items');
  });
});
