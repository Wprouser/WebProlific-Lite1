import PDFDocument from 'pdfkit';

export interface DocumentPdfTaxComponent {
  componentName: string;
  componentRate: string;
  componentAmount: string;
}

export interface DocumentPdfLine {
  itemName: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
  taxComponents: DocumentPdfTaxComponent[];
  lineTaxAmount: string;
  lineTotal: string;
}

export interface DocumentPdfInput {
  documentTypeLabel: string;
  documentNumber: string;
  statusLabel?: string;
  outletName: string;
  supplierName: string;
  supplierEmail?: string;
  currencyCode: string;
  exchangeRateToBase: string;
  dateLabel: string;
  lines: DocumentPdfLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  otherChargesAmount: string;
  totalValue: string;
}

// FR-17's brand primary — same indigo/purple used throughout the app
// (web/src/styles/tokens.css --primary/--primary-strong), so a generated
// document reads as coming from the same product, not a generic template.
const BRAND_PRIMARY = '#6d4cf5';
const BRAND_PRIMARY_STRONG = '#5636d6';
const TEXT_MUTED = '#6b7280';
const TEXT_DARK = '#111827';
const BORDER = '#e5e7eb';

const PAGE_MARGIN = 50;
const PAGE_HEIGHT = 792; // A4 in points minus rounding, pdfkit default 'A4'

/**
 * Server-side PDF generation (spec: "not a frontend print-to-PDF hack"),
 * shared by both PO and GRN — the two documents have near-identical shape
 * (header info, itemized lines with optional compound-tax breakdown,
 * Net/Tax/Discount/Other Charges/Gross totals), so PurchaseOrdersService/GrnService
 * each map their own domain object into this one common shape rather than
 * duplicating a whole rendering routine per document type.
 */
export function generateDocumentPdf(input: DocumentPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, input);
    drawMetaBlock(doc, input);
    const y = drawLineItemsTable(doc, input);
    drawTotals(doc, input, y);
    drawFooter(doc);

    doc.end();
  });
}

function drawHeader(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
  doc.rect(0, 0, doc.page.width, 90).fill(BRAND_PRIMARY);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('WebProlific', PAGE_MARGIN, 30);
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(input.outletName, PAGE_MARGIN, 55);

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(input.documentTypeLabel, doc.page.width - PAGE_MARGIN - 220, 28, { width: 220, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(`# ${input.documentNumber}`, doc.page.width - PAGE_MARGIN - 220, 50, { width: 220, align: 'right' });
  if (input.statusLabel) {
    doc.text(input.statusLabel, doc.page.width - PAGE_MARGIN - 220, 65, { width: 220, align: 'right' });
  }

  doc.fillColor(TEXT_DARK);
}

function drawMetaBlock(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
  const top = 110;
  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 2;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text('SUPPLIER', PAGE_MARGIN, top);
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(TEXT_DARK)
    .text(input.supplierName, PAGE_MARGIN, top + 14);
  if (input.supplierEmail) {
    doc.fontSize(9).fillColor(TEXT_MUTED).text(input.supplierEmail, PAGE_MARGIN, top + 30);
  }

  const rightX = PAGE_MARGIN + colWidth;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text('DATE', rightX, top, { width: colWidth, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(TEXT_DARK)
    .text(input.dateLabel, rightX, top + 14, { width: colWidth, align: 'right' });

  const showRate = Number(input.exchangeRateToBase) !== 1;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(TEXT_MUTED)
    .text('CURRENCY', rightX, top + 34, { width: colWidth, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(TEXT_DARK)
    .text(
      showRate ? `${input.currencyCode} (1 ${input.currencyCode} = ${input.exchangeRateToBase})` : input.currencyCode,
      rightX,
      top + 48,
      { width: colWidth, align: 'right' },
    );
}

const COL_ITEM_X = PAGE_MARGIN;
const COL_QTY_X = PAGE_MARGIN + 220;
const COL_PRICE_X = PAGE_MARGIN + 290;
const COL_TAX_X = PAGE_MARGIN + 360;
const COL_TOTAL_X = PAGE_MARGIN + 450;
const TABLE_WIDTH_RIGHT = COL_TOTAL_X + 45;

function drawLineItemsTable(doc: PDFKit.PDFDocument, input: DocumentPdfInput): number {
  let y = 185;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED);
  doc.text('ITEM', COL_ITEM_X, y);
  doc.text('QTY', COL_QTY_X, y);
  doc.text('PRICE', COL_PRICE_X, y);
  doc.text('TAX', COL_TAX_X, y);
  doc.text('TOTAL', COL_TOTAL_X, y, { width: 45, align: 'right' });
  y += 14;
  doc.moveTo(PAGE_MARGIN, y).lineTo(TABLE_WIDTH_RIGHT, y).strokeColor(BORDER).stroke();
  y += 8;

  for (const line of input.lines) {
    if (y > PAGE_HEIGHT - 150) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK);
    doc.text(line.itemName, COL_ITEM_X, y, { width: 210 });
    doc.text(`${line.quantity}${line.unit ? ` ${line.unit}` : ''}`, COL_QTY_X, y, { width: 65 });
    doc.text(`${input.currencyCode} ${line.unitPrice}`, COL_PRICE_X, y, { width: 65 });
    doc.text(`${input.currencyCode} ${line.lineTaxAmount}`, COL_TAX_X, y, { width: 85 });
    doc.text(`${input.currencyCode} ${line.lineTotal}`, COL_TOTAL_X, y, { width: 45, align: 'right' });
    y += 14;

    // Itemized compound-tax breakdown, matching the on-screen
    // TaxBreakdownDisplay component's behavior (spec: "show the itemized
    // component breakdown... not just a single lumped tax line").
    if (line.taxComponents.length > 1) {
      doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED);
      for (const component of line.taxComponents) {
        doc.text(
          `${component.componentName} ${component.componentRate}%: ${input.currencyCode} ${component.componentAmount}`,
          COL_TAX_X,
          y,
          { width: 130 },
        );
        y += 11;
      }
      doc.fillColor(TEXT_DARK);
    }

    y += 6;
  }

  doc.moveTo(PAGE_MARGIN, y).lineTo(TABLE_WIDTH_RIGHT, y).strokeColor(BORDER).stroke();
  return y + 16;
}

function drawTotals(doc: PDFKit.PDFDocument, input: DocumentPdfInput, y: number): number {
  const labelX = COL_TAX_X;
  const valueWidth = 45;

  function row(label: string, value: string, bold = false): void {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(TEXT_DARK);
    doc.text(label, labelX, y, { width: 85 });
    doc.text(`${input.currencyCode} ${value}`, COL_TOTAL_X, y, { width: valueWidth, align: 'right' });
    y += bold ? 18 : 15;
  }

  row('Net', input.subtotal);
  row('Tax', input.taxAmount);
  if (Number(input.discountAmount) !== 0) {
    row('Discount', `-${input.discountAmount}`);
  }
  if (Number(input.otherChargesAmount) !== 0) {
    row('Other Charges', input.otherChargesAmount);
  }
  doc.moveTo(labelX, y).lineTo(TABLE_WIDTH_RIGHT, y).strokeColor(BRAND_PRIMARY_STRONG).stroke();
  y += 6;
  row('Gross', input.totalValue, true);

  return y;
}

function drawFooter(doc: PDFKit.PDFDocument): void {
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text('Generated by WebProlific', PAGE_MARGIN, doc.page.height - 40, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'center',
    });
}
