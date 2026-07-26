import { GRN } from '../domain/grn.entity';
import { InvoiceScanStatus } from '../constants/enums';

export interface CreateGrnLineTaxComponentInput {
  componentName: string;
  componentRate: string;
  componentAmount: string;
}

export interface CreateGrnLineInput {
  itemId: string;
  // Set only for a PO-linked line — used internally by the repository to
  // update POLine.receivedQty and recompute the PO's status inside the same
  // transaction as this GRN's creation. Never persisted on GRNLine itself
  // (no such column exists — see the schema's GRNLine model), so it's
  // stripped before the GRNLine row is written.
  poLineId?: string;
  orderedQty?: string;
  receivedQty: string;
  actualPrice: string;
  taxRateId?: string;
  taxRate: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  taxComponents: CreateGrnLineTaxComponentInput[];
}

export interface CreateGrnInput {
  outletId: string;
  purchaseOrderId?: string;
  supplierId: string;
  receivedById: string;
  currencyCode: string;
  exchangeRateToBase: string;
  isTaxInclusive: boolean;
  discountAmount: string;
  otherChargesAmount: string;
  subtotal: string;
  taxAmount: string;
  totalValue: string;
  invoiceNumber?: string;
  invoiceScanUrl?: string;
  invoiceScanStatus?: InvoiceScanStatus;
  varianceFlagged: boolean;
  lines: CreateGrnLineInput[];
}

export interface GrnFilters {
  /** Every result row must have an outletId in this set — scoping, not an
   * explicit user-chosen filter. */
  accessibleOutletIds: string[];
  outletId?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface UpdateEmailSentInput {
  lastEmailedAt: Date;
  lastEmailedTo: string;
}

export interface GrnRepository {
  /**
   * Creates the GRN + lines and, atomically in the same transaction: posts a
   * PURCHASE_IN StockTransaction per line, records a SupplierPriceHistory
   * row per line, and — when `purchaseOrderId` is set — updates the linked
   * POLine.receivedQty and recomputes the PurchaseOrder's status. See
   * PrismaGrnRepository for why this crosses module boundaries (same
   * narrow, deliberate exception as PrismaItemRepository's opening-stock
   * path).
   */
  create(data: CreateGrnInput): Promise<GRN>;
  findById(id: string): Promise<GRN | null>;
  findScoped(filters: GrnFilters): Promise<GRN[]>;
  /** Spec: "Every successful send-email call is recorded, including
   * timestamp and recipient, viewable from the PO/GRN detail screen." */
  updateEmailSent(id: string, data: UpdateEmailSentInput): Promise<GRN>;
}
