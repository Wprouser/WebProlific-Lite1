import { Workbook } from 'exceljs';
import {
  SalesFileFormatError,
  parseQuantity,
  parseSaleDate,
  parseSalesCsv,
  parseSalesFile,
  parseSalesXlsx,
  splitCsvLine,
} from './parse-sales-file';

const HEADER = 'Menu Item,Quantity Sold,Sale Date';

describe('splitCsvLine', () => {
  it('handles quoted fields containing commas', () => {
    expect(splitCsvLine('"Biryani, Chicken",2,2026-07-20')).toEqual(['Biryani, Chicken', '2', '2026-07-20']);
  });

  it('handles doubled quotes inside a quoted field', () => {
    expect(splitCsvLine('"Chef""s Special",1,2026-07-20')).toEqual(['Chef"s Special', '1', '2026-07-20']);
  });

  it('preserves empty trailing cells', () => {
    expect(splitCsvLine('a,,')).toEqual(['a', '', '']);
  });
});

describe('parseSaleDate', () => {
  it('accepts ISO dates with and without a time part', () => {
    expect(parseSaleDate('2026-07-20')?.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(parseSaleDate('2026-07-20T12:34:00Z')?.toISOString()).toBe('2026-07-20T12:34:00.000Z');
  });

  it('defaults to day-first, consistently', () => {
    expect(parseSaleDate('03/04/2026')?.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    expect(parseSaleDate('03-04-2026')?.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    // And it does NOT flip interpretation once the day exceeds 12 — that
    // per-row guessing is exactly what the explicit selector replaces.
    expect(parseSaleDate('20/07/2026')?.toISOString()).toBe('2026-07-20T00:00:00.000Z');
  });

  it('reads the same cell differently under MM/DD/YYYY — the whole point of the selector', () => {
    expect(parseSaleDate('03/04/2026', 'MM/DD/YYYY')?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(parseSaleDate('03/04/2026', 'DD/MM/YYYY')?.toISOString()).toBe('2026-04-03T00:00:00.000Z');
  });

  it('accepts ISO under every setting, since it is unambiguous', () => {
    for (const format of ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const) {
      expect(parseSaleDate('2026-07-20', format)?.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    }
  });

  it('rejects a slash date when the uploader said the file is ISO', () => {
    expect(parseSaleDate('03/04/2026', 'YYYY-MM-DD')).toBeNull();
  });

  it('rejects a date that does not exist rather than rolling it forward', () => {
    expect(parseSaleDate('31/02/2026')).toBeNull();
    // 20/07 read month-first has no twentieth month — which is how a file
    // uploaded under the wrong setting announces itself.
    expect(parseSaleDate('20/07/2026', 'MM/DD/YYYY')).toBeNull();
  });

  it('rejects free-text dates instead of handing them to new Date()', () => {
    expect(parseSaleDate('July 20th')).toBeNull();
    expect(parseSaleDate('')).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('parses plain and thousands-separated numbers to 3dp', () => {
    expect(parseQuantity('2')).toBe('2.000');
    expect(parseQuantity('1,250')).toBe('1250.000');
    expect(parseQuantity(' 0.5 ')).toBe('0.500');
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-3')).toBeNull();
    expect(parseQuantity('two')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});

describe('parseSalesCsv', () => {
  it('parses a straightforward export', () => {
    const result = parseSalesCsv(`${HEADER}\nChicken Biryani,2,2026-07-20\nMint Lemonade,3,2026-07-20`);
    expect(result.skipped).toEqual([]);
    expect(result.rows).toEqual([
      {
        rowNumber: 1,
        menuItemName: 'Chicken Biryani',
        sku: null,
        quantitySold: '2.000',
        saleDate: new Date('2026-07-20T00:00:00.000Z'),
        posReferenceRaw: null,
      },
      expect.objectContaining({ rowNumber: 2, menuItemName: 'Mint Lemonade', quantitySold: '3.000' }),
    ]);
  });

  it('tolerates arbitrary column order and header wording', () => {
    const result = parseSalesCsv('Business Date,QTY,PLU Code,Product Name\n2026-07-20,4,BIR-01,Chicken Biryani');
    expect(result.rows[0]).toMatchObject({
      menuItemName: 'Chicken Biryani',
      sku: 'BIR-01',
      quantitySold: '4.000',
    });
  });

  it('picks up an optional POS reference column', () => {
    const result = parseSalesCsv(`${HEADER},Receipt No\nChicken Biryani,1,2026-07-20,R-8891`);
    expect(result.rows[0].posReferenceRaw).toBe('R-8891');
  });

  it('finds the header even when the export starts with title/blank lines', () => {
    const result = parseSalesCsv(`Daily Sales Report\n\n${HEADER}\nChicken Biryani,1,2026-07-20`);
    expect(result.rows).toHaveLength(1);
  });

  it('strips a UTF-8 BOM so the first header cell still matches', () => {
    const result = parseSalesCsv(`\uFEFF${HEADER}\nChicken Biryani,1,2026-07-20`);
    expect(result.rows[0].menuItemName).toBe('Chicken Biryani');
  });

  it('AC: one malformed line never costs the rest of the file', () => {
    const result = parseSalesCsv(
      `${HEADER}\nChicken Biryani,2,2026-07-20\nSubtotal,,\nMint Lemonade,three,2026-07-20\nSaffron Rice,1,2026-07-20`,
    );
    expect(result.rows.map((row) => row.menuItemName)).toEqual(['Chicken Biryani', 'Saffron Rice']);
    // Both the "Subtotal" footer and the "three" quantity are reported by
    // line number rather than silently eaten — a report footer looks exactly
    // like a broken sale row, and the user is the one who can tell them apart.
    expect(result.skipped).toEqual([
      expect.objectContaining({ lineNumber: 3, reason: expect.stringContaining('not a positive number') }),
      expect.objectContaining({ lineNumber: 4, reason: expect.stringContaining('not a positive number') }),
    ]);
  });

  it('renumbers surviving rows contiguously, so rowNumber keys stay stable', () => {
    const result = parseSalesCsv(`${HEADER}\nA,bad,2026-07-20\nB,1,2026-07-20\nC,2,2026-07-20`);
    expect(result.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
  });

  it('ignores fully blank separator lines without reporting them', () => {
    const result = parseSalesCsv(`${HEADER}\nChicken Biryani,1,2026-07-20\n\n\nMint Lemonade,1,2026-07-20`);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it('falls back to the SKU when a row has no name', () => {
    const result = parseSalesCsv('SKU,Qty,Date\nBIR-01,2,2026-07-20');
    expect(result.rows[0]).toMatchObject({ menuItemName: 'BIR-01', sku: 'BIR-01' });
  });

  it('throws when no header row can be identified', () => {
    expect(() => parseSalesCsv('just,some,text\n1,2,3')).toThrow(SalesFileFormatError);
  });

  it('throws when the header has no date column', () => {
    expect(() => parseSalesCsv('Menu Item,Quantity\nChicken Biryani,2')).toThrow(/sale-date column/);
  });

  it('throws when every data row is unusable', () => {
    expect(() => parseSalesCsv(`${HEADER}\nChicken Biryani,zero,nonsense`)).toThrow(/No usable sale rows/);
  });

  it('applies the chosen date format to the whole file', () => {
    const csv = `${HEADER}\nChicken Biryani,2,03/04/2026\nMint Lemonade,1,05/06/2026`;
    expect(parseSalesCsv(csv, 'MM/DD/YYYY').rows.map((row) => row.saleDate.toISOString())).toEqual([
      '2026-03-04T00:00:00.000Z',
      '2026-05-06T00:00:00.000Z',
    ]);
    expect(parseSalesCsv(csv, 'DD/MM/YYYY').rows.map((row) => row.saleDate.toISOString())).toEqual([
      '2026-04-03T00:00:00.000Z',
      '2026-06-05T00:00:00.000Z',
    ]);
  });

  it('names the chosen format when a row cannot be read, since that is the likely cause', () => {
    const result = parseSalesCsv(
      `${HEADER}\nChicken Biryani,2,2026-07-20\nMint Lemonade,1,20/07/2026`,
      'MM/DD/YYYY',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('MM/DD/YYYY');
  });
});

describe('parseSalesXlsx', () => {
  async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sales');
    rows.forEach((row) => sheet.addRow(row));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  it('reads an .xlsx export, including native Excel date cells', async () => {
    const buffer = await workbookBuffer([
      ['Menu Item', 'Quantity Sold', 'Sale Date'],
      ['Chicken Biryani', 2, new Date('2026-07-20T00:00:00.000Z')],
    ]);
    const result = await parseSalesXlsx(buffer);
    expect(result.rows[0]).toMatchObject({ menuItemName: 'Chicken Biryani', quantitySold: '2.000' });
    expect(result.rows[0].saleDate.toISOString()).toBe('2026-07-20T00:00:00.000Z');
  });

  it('routes by extension, and treats an unknown extension as CSV', async () => {
    const xlsx = await workbookBuffer([
      ['Menu Item', 'Qty', 'Date'],
      ['Mint Lemonade', 1, '2026-07-20'],
    ]);
    await expect(parseSalesFile('daily.xlsx', xlsx)).resolves.toMatchObject({ rows: [expect.anything()] });

    const csv = Buffer.from(`${HEADER}\nChicken Biryani,1,2026-07-20`, 'utf8');
    await expect(parseSalesFile('daily-export', csv)).resolves.toMatchObject({ rows: [expect.anything()] });
  });
});
