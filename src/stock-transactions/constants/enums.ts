export const TRANSACTION_TYPES = [
  'PURCHASE_IN',
  'OPENING_BALANCE',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'USAGE_OUT',
  'WASTAGE_OUT',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const REASON_CODES = ['EXPIRED', 'DAMAGED', 'SPILLED', 'OVER_PREPARED'] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// 'SALE' added by FR-06: a POS-driven USAGE_OUT points back at the Sale row
// that caused it, which is what makes a void reversible by replaying the
// exact transactions rather than recomputing from a possibly-edited recipe.
export const REFERENCE_TYPES = ['PO', 'GRN', 'TRANSFER', 'SALE', 'MANUAL'] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

// +1 for *_IN types (added to currentStock), -1 for *_OUT types (subtracted).
export const TRANSACTION_DIRECTION: Record<TransactionType, 1 | -1> = {
  PURCHASE_IN: 1,
  OPENING_BALANCE: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  USAGE_OUT: -1,
  WASTAGE_OUT: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_OUT: -1,
};

// FR-11 permission matrix: "Stock in/out entry: ... CHEF (usage/wastage only)".
export const CHEF_ALLOWED_TYPES: TransactionType[] = ['USAGE_OUT', 'WASTAGE_OUT'];

// FR-02 Validation Rules: only these roles may pass forceOverride:true.
export const FORCE_OVERRIDE_ROLES = ['OUTLET_MANAGER', 'PROPERTY_MANAGER', 'CHAIN_OWNER'] as const;
