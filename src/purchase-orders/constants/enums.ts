export const PO_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT_TO_SUPPLIER',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CLOSED',
  'REJECTED',
  'CANCELLED',
] as const;
export type POStatus = (typeof PO_STATUSES)[number];

// RBAC permission matrix (FR-11): "Create PO" allows everyone except CHEF.
export const PO_CREATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER', 'STORE_STAFF'] as const;

// "Approve PO": CHAIN_OWNER always; PROPERTY_MANAGER/OUTLET_MANAGER only
// below the outlet's poApprovalThreshold (see PurchaseOrdersService). Reject/
// Send/Close share this same set — all are approval-adjacent lifecycle
// steps that follow PENDING_APPROVAL, not routine data entry.
export const PO_APPROVAL_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER', 'OUTLET_MANAGER'] as const;
