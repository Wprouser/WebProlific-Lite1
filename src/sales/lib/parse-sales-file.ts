import { Workbook } from 'exceljs';
import { DEFAULT_SALES_DATE_FORMAT, SalesDateFormat } from '../constants/enums';

/**
 * FR-06 Model 2, step 1: turn an uploaded daily-sales export into staged
 * rows. Deliberately tolerant about *shape* (column order, header wording,
 * junk lines) and strict about *values* — a POS export routinely carries
 * blank separators, subtotal lines and a footer, none of which are sales,
 * but a row that claims to be a sale must yield a real quantity and a real
 * date or it is reported rather than guessed at.
 *
 * Nothing here touches the database or Nest — parsing a file is a pure
 * transformation, and keeping it that way is what makes the format edge
 * cases cheap to test.
 */

export interface ParsedSaleRow {
  /** 1-based position among *data* rows (the header line is not counted). */
  rowNumber: number;
  menuItemName: string;
  sku: string | null;
  /** Fixed to 3dp, matching Decimal(10,3). */
  quantitySold: string;
  saleDate: Date;
  posReferenceRaw: string | null;
}

export interface SkippedSaleLine {
  /** 1-based line number in the file as the user sees it, header included —
   * so "line 14" in an error message matches what their spreadsheet shows. */
  lineNumber: number;
  reason: string;
  raw: string;
}

export interface ParseSalesFileResult {
  rows: ParsedSaleRow[];
  skipped: SkippedSaleLine[];
}

export class SalesFileFormatError extends Error {}

const HEADER_ALIASES: Record<'name' | 'sku' | 'quantity' | 'date' | 'reference', string[]> = {
  name: ['menuitem', 'menuitemname', 'item', 'itemname', 'name', 'product', 'productname', 'description', 'dish'],
  sku: ['sku', 'code', 'itemcode', 'productcode', 'plu', 'plucode'],
  quantity: ['quantity', 'qty', 'quantitysold', 'qtysold', 'sold', 'units', 'count'],
  date: ['date', 'saledate', 'salesdate', 'datetime', 'timestamp', 'transactiondate', 'businessdate'],
  reference: ['reference', 'posreference', 'posreferenceid', 'ref', 'refno', 'receipt', 'receiptno', 'transactionid', 'billno', 'invoiceno'],
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type ColumnMap = Partial<Record<keyof typeof HEADER_ALIASES, number>>;

function mapColumns(headerCells: string[]): ColumnMap {
  const map: ColumnMap = {};
  headerCells.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ColumnMap, string[]][]) {
      // First match wins: a file with both "Item" and "Item Code" must not
      // let the later column overwrite the earlier one's mapping.
      if (map[field] === undefined && aliases.includes(normalized)) {
        map[field] = index;
        return;
      }
    }
  });
  return map;
}

/**
 * Parses one date cell under the format the uploader chose.
 *
 * ISO-8601 (`2026-07-20`, `2026-07-20T12:34:00Z`) is accepted under every
 * setting — it is unambiguous, and Excel's native date cells arrive in that
 * shape regardless of what the user picked. The selected format only decides
 * how to read a *numeric* date like `03/04/2026`, where the file itself
 * carries no clue. Choosing `YYYY-MM-DD` and then uploading slash dates is
 * therefore reported per row rather than guessed at.
 *
 * Anything else is rejected rather than fed to `new Date()`, whose fallback
 * parsing is implementation-defined.
 */
export function parseSaleDate(value: string, format: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/.exec(trimmed);
  if (iso) {
    const parsed = new Date(iso[4] ? trimmed.replace(' ', 'T') : `${trimmed}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (numeric) {
    if (format === 'YYYY-MM-DD') return null;
    const [, first, second, year] = numeric;
    const [day, month] = format === 'MM/DD/YYYY' ? [second, first] : [first, second];
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    // Rejects 31/02/2026: Date.UTC would roll it forward to 3 March rather
    // than complain, so the round-trip is checked explicitly. This is also
    // what catches a file uploaded under the wrong format setting — 13/05
    // read as MM/DD has no thirteenth month.
    if (parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return null;
    return parsed;
  }

  return null;
}

export function parseQuantity(value: string): string | null {
  // Thousands separators and stray spaces are common in exported numbers.
  const cleaned = value.replace(/[\s,]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric.toFixed(3);
}

/** Minimal RFC 4180 splitter: quoted fields, embedded commas, doubled
 * quotes. Deliberately hand-rolled rather than routed through exceljs's CSV
 * reader — that reader coerces values (notably dates) on its own terms, and
 * this parser needs the raw text so date interpretation stays in one place,
 * documented, above. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // exceljs hands back rich text / formula / hyperlink objects.
    const record = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(record.richText)) return record.richText.map((part) => part.text).join('');
    if (record.text !== undefined) return String(record.text);
    if (record.result !== undefined) return String(record.result);
    return '';
  }
  return String(value);
}

function buildRows(grid: string[][], dateFormat: SalesDateFormat): ParseSalesFileResult {
  const headerIndex = grid.findIndex((cells) => {
    const map = mapColumns(cells);
    return (map.name !== undefined || map.sku !== undefined) && map.quantity !== undefined;
  });
  if (headerIndex === -1) {
    throw new SalesFileFormatError(
      'Could not find a header row. The file needs columns for the menu item (name or SKU), quantity sold, and sale date.',
    );
  }

  const columns = mapColumns(grid[headerIndex]);
  if (columns.date === undefined) {
    throw new SalesFileFormatError('Could not find a sale-date column in the header row.');
  }

  const rows: ParsedSaleRow[] = [];
  const skipped: SkippedSaleLine[] = [];

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    const lineNumber = i + 1;
    const raw = cells.join(', ');
    const at = (index: number | undefined) => (index === undefined ? '' : (cells[index] ?? '').trim());

    // Blank separator lines are structural, not errors — don't report them.
    if (cells.every((cell) => cell.trim() === '')) continue;

    const menuItemName = at(columns.name);
    const sku = at(columns.sku);
    if (!menuItemName && !sku) {
      skipped.push({ lineNumber, reason: 'No menu item name or SKU', raw });
      continue;
    }

    const quantitySold = parseQuantity(at(columns.quantity));
    if (quantitySold === null) {
      skipped.push({ lineNumber, reason: `Quantity "${at(columns.quantity)}" is not a positive number`, raw });
      continue;
    }

    const saleDate = parseSaleDate(at(columns.date), dateFormat);
    if (saleDate === null) {
      skipped.push({
        lineNumber,
        // Names the chosen format, because the likeliest cause of this is
        // that the wrong one was picked for the file.
        reason: `Date "${at(columns.date)}" could not be read as ${dateFormat} (or YYYY-MM-DD)`,
        raw,
      });
      continue;
    }

    rows.push({
      rowNumber: rows.length + 1,
      menuItemName: menuItemName || sku,
      sku: sku || null,
      quantitySold,
      saleDate,
      posReferenceRaw: at(columns.reference) || null,
    });
  }

  if (rows.length === 0) {
    throw new SalesFileFormatError('No usable sale rows were found in this file.');
  }
  return { rows, skipped };
}

export function parseSalesCsv(
  content: string,
  dateFormat: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT,
): ParseSalesFileResult {
  const grid = content
    // Excel writes a UTF-8 BOM; left in place it corrupts the first header
    // cell. Written as an escape rather than the literal character so it
    // stays visible to anyone reading this file.
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .map(splitCsvLine);
  return buildRows(grid, dateFormat);
}

export async function parseSalesXlsx(
  buffer: Buffer,
  dateFormat: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT,
): Promise<ParseSalesFileResult> {
  const workbook = new Workbook();
  // Cast: exceljs's bundled type for `load` predates @types/node's generic
  // Buffer<ArrayBufferLike>, so the two Buffer types no longer unify even
  // though the runtime value is exactly what it wants.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SalesFileFormatError('The workbook has no sheets.');

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    // `values` is 1-based with a leading hole, per exceljs's own API.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) cells.push(cellToText(values[i]).trim());
    grid.push(cells);
  });
  return buildRows(grid, dateFormat);
}

/** Dispatches on file extension, falling back to CSV — a POS "CSV export"
 * is sometimes served as text/plain or with no extension at all, and CSV is
 * the format that degrades gracefully when guessed wrong (an XLSX read as
 * CSV fails loudly on the header search rather than producing nonsense). */
export async function parseSalesFile(
  fileName: string,
  buffer: Buffer,
  dateFormat: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT,
): Promise<ParseSalesFileResult> {
  if (/\.xlsx?$/i.test(fileName)) return parseSalesXlsx(buffer, dateFormat);
  return parseSalesCsv(buffer.toString('utf8'), dateFormat);
}
