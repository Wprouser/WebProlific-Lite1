import { POStatus } from '../constants/enums';

export interface POLineTaxComponent {
  id: string;
  poLineId: string;
  componentName: string;
  componentRate: string;
  componentAmount: string;
  sortOrder: number;
}

export interface POLine {
  id: string;
  purchaseOrderId: string;
  itemId: string;
  orderedQty: string;
  expectedPrice: string;
  taxRateId: string | null;
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  receivedQty: string;
  taxComponents: POLineTaxComponent[];
}

export interface PurchaseOrder {
  id: string;
  outletId: string;
  supplierId: string;
  status: POStatus;
  expectedDeliveryDate: Date | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  lines: POLine[];
  createdAt: Date;
  lastEmailedAt: Date | null;
  lastEmailedTo: string | null;
}
