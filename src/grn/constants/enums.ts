// FR-04's GRN business rules. GRN itself has no lifecycle/status field of
// its own (unlike PurchaseOrder) — it's created once via one of the three
// flows and stands as a finalized record; only `varianceFlagged` captures
// anything about how it was created.

// Same set as PO_CREATE_ROLES — receiving stock is routine frontline work,
// not an approval-adjacent action (see PO_APPROVAL_ROLES for the narrower
// set used below for the variance-override gate).
export const GRN_CREATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'STORE_STAFF'] as const;

// Spec: "require OUTLET_MANAGER-or-higher approval before proceeding (403
// for STORE_STAFF role attempting to finalize a variance GRN)."
export const GRN_VARIANCE_OVERRIDE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'] as const;

// Spec: "abs(receivedQty - orderedQty) / orderedQty > toleranceConfig
// (default 10%)". No schema field exists for a per-outlet override (the
// Technical Spec doesn't add one alongside GRN/GRNLine), so this is a fixed
// application constant, not configurable per outlet — flagged here as a
// deliberate, minimal reading of "default 10%" rather than inventing an
// unspec'd settings field.
export const VARIANCE_TOLERANCE_PERCENT = 10;

export const INVOICE_SCAN_STATUSES = ['NONE', 'UPLOADED', 'PROCESSING', 'EXTRACTED', 'FAILED'] as const;
export type InvoiceScanStatus = (typeof INVOICE_SCAN_STATUSES)[number];
