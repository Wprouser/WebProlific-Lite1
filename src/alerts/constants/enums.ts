// Application-layer stand-ins for FR-07's AlertType/AlertStatus enums —
// Prisma's SQL Server connector rejects the `enum` construct outright (see
// prisma/schema.prisma's header note), so these are the single source of
// truth for allowed values, same pattern as every other module here.

export const ALERT_TYPES = ['LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRY_WARNING'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** The stock-level types, as opposed to expiry — these are the ones that
 * auto-resolve when stock recovers. */
export const STOCK_ALERT_TYPES: AlertType[] = ['LOW_STOCK', 'OUT_OF_STOCK'];

/**
 * An alert is "live" while it is either untouched or merely acknowledged —
 * acknowledging says "I've seen it", not "it's fixed". Both states therefore
 * suppress a duplicate and both get auto-resolved when stock recovers.
 */
export const LIVE_ALERT_STATUSES: AlertStatus[] = ['OPEN', 'ACKNOWLEDGED'];

/**
 * Defaults for the two tuning knobs FR-07 names but gives no home in the
 * schema. Environment-level for now (ALERT_COOLDOWN_HOURS,
 * EXPIRY_ALERT_LEAD_DAYS); if these ever need to differ per outlet they
 * become Outlet columns, and this stays the fallback.
 */
export const DEFAULT_ALERT_COOLDOWN_HOURS = 24;
export const DEFAULT_EXPIRY_ALERT_LEAD_DAYS = 3;

/** FR-11: acknowledging or resolving an alert is an operational action, so
 * it matches the stock-moving role set rather than the narrower manager-only
 * one used for master data. */
export const ALERT_MUTATE_ROLES = [
  'CHAIN_OWNER',
  'PROPERTY_MANAGER',
  'OUTLET_MANAGER',
  'STORE_STAFF',
  'CHEF',
] as const;
