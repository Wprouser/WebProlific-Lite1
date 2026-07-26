import { InvoiceScanStatus } from '../constants/enums';

export interface GRNLineTaxComponent {
  id: string;
  grnLineId: string;
  componentName: string;
  componentRate: string;
  componentAmount: string;
  sortOrder: number;
}

export interface GRNLine {
  id: string;
  grnId: string;
  itemId: string;
  // Null for a Direct GRN line — nothing was ordered, so there's nothing to
  // compare received-vs-ordered against.
  orderedQty: string | null;
  receivedQty: string;
  actualPrice: string;
  taxRateId: string | null;
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  taxComponents: GRNLineTaxComponent[];
}

export interface GRN {
  id: string;
  outletId: string;
  purchaseOrderId: string | null;
  supplierId: string;
  receivedById: string;
  receivedAt: Date;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  invoiceNumber: string | null;
  invoiceScanUrl: string | null;
  invoiceScanStatus: InvoiceScanStatus | null;
  varianceFlagged: boolean;
  lines: GRNLine[];
  lastEmailedAt: Date | null;
  lastEmailedTo: string | null;
}
