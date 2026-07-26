import { Prisma } from '@prisma/client';
import { PurchaseOrder } from '../domain/purchase-order.entity';
import { POStatus } from '../constants/enums';

export interface CreatePOLineTaxComponentInput {
  componentName: string;
  componentRate: string;
  componentAmount: string;
}

export interface CreatePOLineInput {
  itemId: string;
  orderedQty: string;
  expectedPrice: string;
  taxRateId?: string;
  // Snapshotted overall percent + computed amounts — the service (not the
  // repository) computes these via apply-document-tax.ts before calling in.
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  taxComponents: CreatePOLineTaxComponentInput[];
}

export interface CreatePurchaseOrderInput {
  outletId: string;
  supplierId: string;
  createdById: string;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  expectedDeliveryDate?: Date;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  lines: CreatePOLineInput[];
}

// Same shape as create, minus the fields that never change post-creation
// (outletId, createdById) — used only for the DRAFT-only edit path
// (PurchaseOrdersService.update), which replaces lines wholesale exactly
// like TaxRateComponent's own "delete + recreate" precedent.
export interface UpdatePurchaseOrderInput {
  supplierId?: string;
  currencyCode?: string;
  exchangeRateToBase?: string;
  isTaxInclusive?: boolean;
  discountAmount?: string;
  otherChargesAmount?: string;
  expectedDeliveryDate?: Date | null;
  subtotal?: string;
  taxAmount?: string;
  totalValue?: string;
  lines?: CreatePOLineInput[];
}

export interface UpdateStatusInput {
  status: POStatus;
  approvedById?: string | null;
  approvedAt?: Date | null;
}

export interface POFilters {
  /** Every result row must have an outletId in this set — scoping, not an
   * explicit user-chosen filter. */
  accessibleOutletIds: string[];
  outletId?: string;
  status?: POStatus;
  supplierId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface ApplyGrnReceiptLineInput {
  poLineId: string;
  receivedQty: string;
}

export interface UpdateEmailSentInput {
  lastEmailedAt: Date;
  lastEmailedTo: string;
}

export interface PurchaseOrderRepository {
  create(data: CreatePurchaseOrderInput): Promise<PurchaseOrder>;
  findById(id: string): Promise<PurchaseOrder | null>;
  /** DRAFT-only edit path — replaces lines wholesale when `lines` is given. */
  update(id: string, data: UpdatePurchaseOrderInput): Promise<PurchaseOrder>;
  updateStatus(id: string, data: UpdateStatusInput): Promise<PurchaseOrder>;
  findScoped(filters: POFilters): Promise<PurchaseOrder[]>;
  /**
   * Increments each named POLine.receivedQty by this GRN's received
   * quantity and recomputes the PO's status (FULLY_RECEIVED / PARTIALLY_
   * RECEIVED). Takes an externally-supplied `tx` rather than opening its
   * own transaction — GrnRepository calls this from inside its own
   * `prisma.$transaction`, so the PO update lands atomically with the GRN's
   * own creation, StockTransaction postings, and SupplierPriceHistory rows.
   */
  applyGrnReceipt(tx: Prisma.TransactionClient, poId: string, lines: ApplyGrnReceiptLineInput[]): Promise<void>;
  /** Spec: "Every successful send-email call is recorded, including
   * timestamp and recipient, viewable from the PO/GRN detail screen." */
  updateEmailSent(id: string, data: UpdateEmailSentInput): Promise<PurchaseOrder>;
}
