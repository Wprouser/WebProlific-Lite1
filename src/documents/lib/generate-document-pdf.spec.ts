import { generateDocumentPdf, DocumentPdfInput } from './generate-document-pdf';

function fixtureInput(overrides: Partial<DocumentPdfInput> = {}): DocumentPdfInput {
  return {
    documentTypeLabel: 'Purchase Order',
    documentNumber: 'ABCD1234',
    statusLabel: 'APPROVED',
    outletName: 'Main Restaurant',
    supplierName: 'Al-Fahad Trading',
    supplierEmail: 'supplier@example.com',
    currencyCode: 'SAR',
    exchangeRateToBase: '1',
    dateLabel: '1/1/2026',
    lines: [
      {
        itemName: 'Basmati Rice',
        quantity: '20.000',
        unit: 'KG',
        unitPrice: '87.00',
        taxComponents: [],
        lineTaxAmount: '261.00',
        lineTotal: '2001.00',
      },
    ],
    subtotal: '1740.00',
    taxAmount: '261.00',
    discountAmount: '0.00',
    otherChargesAmount: '0.00',
    totalValue: '2001.00',
    ...overrides,
  };
}

describe('generateDocumentPdf', () => {
  it('AC: produces a real, formatted PDF document (not a browser print of the UI)', async () => {
    const buffer = await generateDocumentPdf(fixtureInput());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PDF file signature — proves this is a genuine PDF, not arbitrary bytes.
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('handles a compound (itemized) tax breakdown without throwing', async () => {
    const buffer = await generateDocumentPdf(
      fixtureInput({
        lines: [
          {
            itemName: 'Basmati Rice',
            quantity: '20.000',
            unit: 'KG',
            unitPrice: '87.00',
            taxComponents: [
              { componentName: 'CGST', componentRate: '9.00', componentAmount: '130.50' },
              { componentName: 'SGST', componentRate: '9.00', componentAmount: '130.50' },
            ],
            lineTaxAmount: '261.00',
            lineTotal: '2001.00',
          },
        ],
      }),
    );
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('handles non-zero Discount and Other Charges amounts without throwing', async () => {
    const buffer = await generateDocumentPdf(
      fixtureInput({ discountAmount: '10.00', otherChargesAmount: '25.00', totalValue: '2016.00' }),
    );
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('handles many line items across a page break without throwing', async () => {
    const manyLines = Array.from({ length: 60 }, (_, i) => ({
      itemName: `Item ${i}`,
      quantity: '1.000',
      unit: 'PIECE',
      unitPrice: '10.00',
      taxComponents: [],
      lineTaxAmount: '0.00',
      lineTotal: '10.00',
    }));
    const buffer = await generateDocumentPdf(fixtureInput({ lines: manyLines }));
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('handles a document with no exchange-rate difference (same currency as base)', async () => {
    const buffer = await generateDocumentPdf(fixtureInput({ exchangeRateToBase: '1' }));
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('handles a foreign-currency document with a non-1 exchange rate', async () => {
    const buffer = await generateDocumentPdf(fixtureInput({ currencyCode: 'USD', exchangeRateToBase: '3.750000' }));
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
