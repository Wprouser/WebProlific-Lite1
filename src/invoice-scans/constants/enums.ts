export const INVOICE_SCAN_STATUSES = ['PROCESSING', 'EXTRACTED', 'FAILED'] as const;
export type InvoiceScanProcessingStatus = (typeof INVOICE_SCAN_STATUSES)[number];

// Same broad set as GRN_CREATE_ROLES — uploading an invoice to scan is part
// of receiving stock (Flow 3), not an approval-adjacent action.
export const INVOICE_SCAN_CREATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'STORE_STAFF'] as const;

// Minimum normalized-similarity score (0-1) for a fuzzy name match to be
// considered confident enough to pre-select — below this, the spec's own
// rule applies: "the line is shown unmatched and the user picks the
// correct item manually."
export const FUZZY_MATCH_THRESHOLD = 0.6;
