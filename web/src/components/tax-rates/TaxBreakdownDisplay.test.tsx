import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaxBreakdownDisplay } from './TaxBreakdownDisplay';

describe('TaxBreakdownDisplay', () => {
  it('AC: renders a simple rate as a single lumped tax line', () => {
    render(<TaxBreakdownDisplay lineTaxAmount="15.00" components={[]} />);
    expect(screen.getByText('15.00')).toBeInTheDocument();
  });

  it('AC: renders a compound rate as one itemized line per component, not a single lumped figure', () => {
    render(
      <TaxBreakdownDisplay
        lineTaxAmount="36.00"
        components={[
          { componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' },
          { componentName: 'SGST', componentRate: '9.00', componentAmount: '18.00' },
        ]}
      />,
    );
    expect(screen.getByText('CGST 9.00%: 18.00')).toBeInTheDocument();
    expect(screen.getByText('SGST 9.00%: 18.00')).toBeInTheDocument();
    expect(screen.queryByText('36.00')).not.toBeInTheDocument();
  });

  it('prefixes each amount with the currency code when provided', () => {
    render(
      <TaxBreakdownDisplay
        lineTaxAmount="36.00"
        currencyCode="SAR"
        components={[{ componentName: 'CGST', componentRate: '9.00', componentAmount: '18.00' }]}
      />,
    );
    expect(screen.getByText('CGST 9.00%: SAR 18.00')).toBeInTheDocument();
  });
});
