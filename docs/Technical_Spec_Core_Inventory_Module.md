# Technical Specification — Core Inventory Module
## Implementation-Ready Spec for Development (Human or AI Coding Agent)

**Companion to:** SDLC_Document_AI_Inventory_App.md (Section 5.1, FR-01 to FR-12)
**Stack assumed:** Node.js (NestJS) + TypeScript + SQL Server (via Prisma ORM, Repository Pattern — see SDLC doc §6.2 for the database portability strategy, since PostgreSQL/MySQL remain drop-in alternatives under this architecture) + React/React Native frontend
**Purpose:** Each Functional Requirement below is broken into a data model, REST API contract, validation rules, business logic, and acceptance criteria — enough to implement directly without further clarification.

**Conventions used throughout:**
- All endpoints are prefixed `/api/v1`
- All endpoints require `Authorization: Bearer <JWT>` unless stated otherwise
- All list endpoints support `?page=&limit=&sort=` query params
- All monetary fields are `Decimal(12,2)`; all quantity fields are `Decimal(10,3)` (to support fractional units like 0.5 kg)
- Standard error response shape:
```json
{ "statusCode": 400, "error": "Bad Request", "message": "min_stock must be less than max_stock", "field": "min_stock" }
```

**SQL Server schema compatibility notes (read before implementing any model below):** Prisma's SQL Server connector has a few gaps versus PostgreSQL that shape how a couple of fields in this spec are modeled:
- **No scalar array type.** Any field that would naturally be a list (e.g., backup codes) is modeled as its own related table with one row per item, not a `String[]` field — this is actually the better long-term design anyway (each item individually queryable/updatable), so it's called out explicitly wherever it applies (see FR-13's `TwoFactorBackupCode` model).
- **No native `Json` column type.** Fields holding structured/variable-shape data (e.g., `ActivityLog.metadata`) are modeled as `String` (mapped to `NVARCHAR(MAX)`), with the application layer doing `JSON.stringify`/`JSON.parse` at the repository boundary rather than relying on Prisma's `Json` filtering. This is called out explicitly where it applies (see FR-18).
- **`enum` is not supported at all — schema validation rejects it outright when `provider = "sqlserver"`, not just lacking a native DB enum type.** Every `enum` declared in this document's Prisma model snippets (e.g., `TransactionType`, `POStatus`, `AlertType`, `AlertStatus`, `TransferStatus`, `Role`, `ScopeType`, `TwoFactorMethod`, `ActivityCategory`, `PropertyType`, `OutletType`) must be implemented as a `String` column instead, with the allowed values enforced at the application layer via a shared TypeScript union type + `class-validator` (e.g., `@IsIn([...])`) rather than a database-level enum constraint. Keep the value spellings identical to what's shown in this spec (e.g., `'PENDING_APPROVAL'`, `'WASTAGE_OUT'`) so the string values stay meaningful and consistent across every module, and centralize each set of allowed values in one shared constants/enums file per domain area (e.g., `src/tenancy/constants/enums.ts` for FR-00's scope/role enums) rather than re-declaring the same value list in multiple places.

---

## FR-00: Multi-Tenant Organizational Hierarchy (Chain → Property → Outlet)

This is foundational — every other module in this document scopes its data through this hierarchy, so it must be built first.

### Concept
- **Chain** — the top-level tenant. The customer account itself (e.g., "Al Waha Hospitality Group"). Owns billing/subscription.
- **Property** — a physical site belonging to a chain (e.g., "Al Waha Jeddah Hotel", or for a standalone restaurant business, the restaurant's single site). A chain can have one or many properties.
- **Outlet** — an operational unit within a property where inventory is actually tracked (e.g., "Main Restaurant", "Pool Bar", "Room Service Kitchen", "Banquet Kitchen"). A property can have one or many outlets. **This is the same `Outlet` entity used throughout FR-01 to FR-12** — no change to those models' `outletId` fields, this section just adds the layers above it.

A standalone restaurant with no hotel and no other branches still fits the model as `Chain(1) → Property(1) → Outlet(1)` — the hierarchy doesn't force complexity on small single-site customers, it just also scales up cleanly for chains.

### Data Model
```prisma
model Chain {
  id            String   @id @default(uuid())
  name          String
  baseCurrency  String   @default("SAR")   // group-level default; properties/outlets may override
  subscriptionPlan String @default("STANDARD")
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  properties    Property[]
}

model Property {
  id           String   @id @default(uuid())
  chainId      String
  chain        Chain    @relation(fields: [chainId], references: [id])
  name         String
  type         PropertyType   // HOTEL | STANDALONE_RESTAURANT | RESTAURANT_GROUP_SITE
  address      String?
  timezone     String   @default("Asia/Riyadh")
  isActive     Boolean  @default(true)
  outlets      Outlet[]

  @@index([chainId])
}

model Outlet {
  id           String   @id @default(uuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id])
  chainId      String   // denormalized from property.chainId for fast scoped queries — see note below
  name         String   // e.g. "Main Restaurant", "Pool Bar", "Room Service Kitchen"
  type         OutletType   // RESTAURANT | BAR | KITCHEN | STORE | ROOM_SERVICE
  baseCurrency String   @default("SAR")   // inherited from property/chain by default, overridable per outlet
  poApprovalThreshold Decimal @db.Decimal(12,2)?
  isActive     Boolean  @default(true)

  @@index([propertyId])
  @@index([chainId])
}
```

**Denormalization note:** `Outlet.chainId` duplicates what's derivable via `outlet.property.chainId`, but every single tenant-scoped table in this document (Item, StockTransaction, Supplier, PurchaseOrder, MenuItem, Alert, StockTransfer, etc.) filters by `outletId` on the hot path. Rather than adding a 2-hop join to every one of those queries just to check chain/property scope, resolve the user's **effective outlet ID list** once at request-auth time (see RBAC below) and continue filtering by `outletId` everywhere else unchanged. This keeps FR-01–FR-12 as written, with no schema changes needed to those modules beyond what tax/currency already added.

### Access Control Across the Hierarchy (extends FR-11)

Replace the flat `User.outletIds` array from FR-11/FR-13 with a scope-based access table, since a user might be granted access at any level of the hierarchy:

```prisma
enum ScopeType { CHAIN, PROPERTY, OUTLET }

model UserAccess {
  id        String    @id @default(uuid())
  userId    String
  scopeType ScopeType
  scopeId   String     // a chainId, propertyId, or outletId, depending on scopeType
  role      Role       // role is granted per-scope, so the same user could be PROPERTY_MANAGER at one property and OUTLET_STAFF at another
  createdAt DateTime   @default(now())

  @@unique([userId, scopeType, scopeId])
}

enum Role {
  CHAIN_OWNER        // full access across every property/outlet in the chain; only role that can manage billing/chain settings
  PROPERTY_MANAGER    // full access across every outlet within their assigned property(ies) — supersedes the old plain "MANAGER"
  OUTLET_MANAGER       // full access within their assigned outlet(s) only (was "MANAGER" in earlier FR-04/FR-11 drafts)
  STORE_STAFF
  CHEF
}
```

**Resolving effective outlet access (runs once per request, in the auth guard):**
1. Load all `UserAccess` rows for `req.user.id`.
2. For each `CHAIN` scope row → include every `Outlet` under every `Property` of that chain.
3. For each `PROPERTY` scope row → include every `Outlet` under that property.
4. For each `OUTLET` scope row → include that outlet directly.
5. Union the results into `req.effectiveOutletIds: string[]` and `req.effectiveRole` (highest-privilege role among matching scopes, if a user somehow has multiple grants touching the same resource).
6. Every existing FR-01–FR-12 endpoint's `outletId` filter/ownership check now validates against `req.effectiveOutletIds` instead of a flat array — this is the **only** change required in those modules' authorization logic.

Cache the resolved `effectiveOutletIds` per request (not per login session) so role/scope changes (FR-14) take effect on the next request without requiring logout — consistent with the token-refresh-latency note already in FR-14.

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/chains` | Create a chain (internal/admin-provisioning use, e.g. during customer onboarding) |
| `GET` | `/chains/:id` | Chain detail incl. property count, outlet count |
| `PATCH` | `/chains/:id` | Update chain settings (CHAIN_OWNER only) |
| `POST` | `/chains/:id/properties` | Add a property to a chain |
| `GET` | `/properties/:id` | Property detail incl. its outlets |
| `PATCH` | `/properties/:id` | Update property |
| `POST` | `/properties/:id/outlets` | Add an outlet to a property |
| `GET` | `/outlets/:id` | Outlet detail |
| `PATCH` | `/outlets/:id` | Update outlet settings |
| `GET` | `/chains/:id/hierarchy` | Full nested tree: chain → properties → outlets (for building nav/switcher UI) |

### Business Logic
- Only `CHAIN_OWNER` can create/edit properties and chain-level settings; `PROPERTY_MANAGER` can edit outlets within their own property but not create new properties.
- Deleting/deactivating a `Property` or `Chain` cascades a soft-deactivation to all child outlets (never a hard delete — historical transactional data must remain queryable).
- **Property/Outlet switcher UI:** since a user may have access to multiple properties or outlets (e.g., a CHAIN_OWNER, or a STORE_STAFF who covers two outlets), the frontend needs a persistent context switcher (typically in the top nav) showing "currently viewing: [Outlet name] — [Property name]"; this selection is client-side state, not server session state, since a user's effective access list can span many outlets simultaneously.

### Acceptance Criteria
- [ ] A CHAIN_OWNER can view/manage data across every property and outlet in their chain without explicit per-outlet grants
- [ ] A PROPERTY_MANAGER cannot access outlets belonging to a different property, even within the same chain
- [ ] Granting a user OUTLET-scoped access to a single outlet does not expose sibling outlets under the same property
- [ ] `effectiveOutletIds` resolution correctly unions overlapping grants (e.g., a CHAIN grant plus an additional OUTLET grant elsewhere doesn't cause duplicate or missing outlets)
- [ ] Deactivating a Property deactivates all its Outlets but preserves their historical data

---

## FR-01: Item Master Management

### Data Model (Prisma schema)

**Deliberately excluded fields** (common in general/retail inventory tools, but not relevant to F&B/hospitality raw-material inventory): Dimensions, Weight, Manufacturer, Brand, UPC, MPN, EAN, ISBN. These are product-catalog/e-commerce concepts for items resold as-is to end consumers — they don't apply to raw ingredients and supplies procured in bulk by weight/volume/count for internal kitchen/store use. Do not add them.

**Also deliberately excluded from Item Master specifically:** Selling Price / Sales Account / Sales-side Tax. An `Item` in this system is a raw ingredient or supply — it is never sold directly to a customer, so it has no selling price of its own. The concept of "what a customer pays" belongs entirely to `MenuItem`/`Recipe` (FR-05), which derives its cost from the Items consumed in its recipe. Do not add sales-side fields to `Item` — this is a meaningful distinction from general-purpose inventory tools (like the reference screenshots), which conflate "things you stock" with "things you sell." In this system those are two different entities.

```prisma
model Item {
  id              String   @id @default(uuid())
  outletId        String
  outlet          Outlet   @relation(fields: [outletId], references: [id])
  name            String
  categoryId      String
  category        Category @relation(fields: [categoryId], references: [id])
  sku             String   @unique
  barcode         String?  @unique
  unit            Unit     // enum: KG, LITRE, PIECE, BOX, GRAM, ML
  minStock        Decimal  @db.Decimal(10,3)   // "Reorder Point" in UI copy
  maxStock        Decimal  @db.Decimal(10,3)
  currentStock    Decimal  @db.Decimal(10,3) @default(0)  // denormalized, updated via StockTransaction
  shelfLifeDays   Int?
  costPrice       Decimal  @db.Decimal(12,2)   // current/latest cost, used for stock valuation (FR-10) — see SupplierPriceHistory (FR-03) for cost trend over time
  purchaseGLAccount String?  // optional free-text or lookup value (e.g., "Cost of Goods Sold", "Inventory Asset") for accounting-export purposes — no GL/ledger logic is implemented in-app; this is metadata carried through on exports for the outlet's external accounting system
  defaultTaxRateId String?  // optional FK to TaxRate (FR-04) — pre-fills tax on PO/GRN lines for this item, always editable per-line at the time of the actual transaction
  defaultSupplierId String?
  storageLocation String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([outletId, isActive])
  @@index([categoryId])
}

model ItemImage {
  id        String   @id @default(uuid())
  itemId    String
  url       String   // object-storage URL
  isPrimary Boolean  @default(false)   // exactly one image per item may be primary — enforced in service logic, not a DB constraint
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())

  @@index([itemId])
}

model Category {
  id       String @id @default(uuid())
  name     String
  outletId String
  @@unique([name, outletId])
}
```

**On the reference screenshots' "Inventory Valuation Method" (FIFO) and "Committed Stock" concepts:** both are deliberately **not** built in this pass. FIFO/weighted-average costing requires lot/batch-level cost tracking (knowing which specific batch of stock is being consumed, at what cost, in what order) — a meaningful scope increase over the single denormalized `costPrice` this spec uses. "Committed Stock" (stock reserved against a pending sales order) doesn't apply here, since this system doesn't take customer orders — it's an internal kitchen/store tool, not a sales/e-commerce platform. Both are reasonable *future* enhancements if the product ever needs precise cost-layer accounting, but are explicitly out of scope for FR-01 — don't build them now.

### API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/items` | Create item (optionally with opening stock — see below) |
| `GET` | `/items` | List items (filters: `categoryId`, `isActive`, `search`, `belowMinStock=true`) |
| `GET` | `/items/:id` | Get item detail |
| `PATCH` | `/items/:id` | Update item |
| `DELETE` | `/items/:id` | Soft-delete / deactivate (sets `isActive=false`) — labeled **"Mark as Inactive"** in the UI, never "Delete," to avoid implying data loss |
| `POST` | `/items/:id/clone` | Create a new item pre-filled from an existing one (name suffixed "(Copy)," SKU cleared for the user to set) — a convenience shortcut, not a distinct data concept |
| `POST` | `/items/bulk-import` | CSV/Excel bulk import (multipart file upload) |
| `GET` | `/items/categories` | List categories |
| `POST` | `/items/categories` | Create category |
| `POST` | `/items/:id/images` | Upload an item image (multipart) — first image uploaded is automatically marked primary |
| `PATCH` | `/items/:id/images/:imageId/primary` | Mark a different image as primary |
| `DELETE` | `/items/:id/images/:imageId` | Remove an image |

**POST /items — Request** (opening stock is optional, captured at creation time rather than as a separate manual stock-in step):
```json
{
  "name": "Basmati Rice",
  "categoryId": "uuid",
  "sku": "RICE-BAS-001",
  "barcode": "8901030123456",
  "unit": "KG",
  "minStock": 10,
  "maxStock": 100,
  "shelfLifeDays": 365,
  "costPrice": 85.50,
  "purchaseGLAccount": "Cost of Goods Sold",
  "defaultTaxRateId": "uuid-or-null",
  "defaultSupplierId": "uuid",
  "storageLocation": "Dry Store",
  "openingStock": { "quantity": 25, "ratePerUnit": 85.50 }
}
```
**Response 201:** full Item object including generated `id`. If `openingStock` was provided, `currentStock` reflects that quantity immediately (the service creates a `StockTransaction` with `type: OPENING_BALANCE` — per FR-02 — as part of the same request, not a follow-up call the frontend has to remember to make); if omitted, `currentStock: 0`.

### Item Detail Screen

Restructured as a dedicated detail view (not just an edit form) — reference: the tabbed detail-page pattern with a right-hand stock summary panel, adapted to this system's simpler (no committed-stock/reservation) model.

**Layout:**
- **Header:** item name, SKU, primary image thumbnail, and an actions area: **Edit**, **Adjust Stock** (a shortcut into FR-02's stock transaction form, pre-filled with this item), and a **More** menu containing **Clone Item**, **Mark as Inactive** (or **Reactivate**, if already inactive), and **Manage Categories** shortcut. There is no "Delete" action anywhere in this UI — soft-deactivation is the only removal path, consistent with the spec's "items are never hard-deleted" rule.
- **Tabs:**
  - **Overview** — the item's master data: category, unit, reorder point (min/max stock), shelf life, storage location, cost price, default tax, default supplier, purchase GL account (if set), and the image gallery.
  - **Transactions** — a filtered view of `StockTransaction` rows for this item specifically (reuses the FR-02 transaction list component, pre-filtered to `itemId`).
  - **History** — this item's `TransactionLog` entries (FR-18) — the field-level change history (e.g., "Reorder point changed from 10 to 15 on [date]"), not the same data as the Transactions tab.
- **Right-hand stock summary panel:** simplified from the reference (which splits Accounting Stock vs. Physical Stock with a Committed Stock line — not applicable here, since this system has no order-reservation concept). Shows just: **Current Stock** (`Item.currentStock`), **Stock Value** (`currentStock × costPrice`), and, if set, **Opening Stock** (the quantity/rate captured at item creation, kept visible as a reference point rather than only living inside transaction history).

### Business Logic
- On soft-delete/deactivate (`DELETE /items/:id`): check for any `PurchaseOrder` with status not in `[Closed, Cancelled, Rejected]` referencing this item → if found, return `409` with message "Cannot deactivate item with open purchase orders."
- `currentStock` is **never** written directly via this endpoint — it is only ever mutated by the Stock Transaction service (FR-02) to preserve the single-source-of-truth invariant. The one exception is `openingStock` at creation time, which internally calls the FR-02 service to create a proper `OPENING_BALANCE` transaction — the endpoint never writes `currentStock` as a raw field itself, even in that case.
- **Clone Item:** copies all master-data fields (category, unit, min/max stock, cost price, default tax, default supplier, storage location) except `sku` (cleared — must be set by the user, since it must be unique) and `currentStock`/opening stock (the clone always starts at 0 — cloning an item definition is not the same as duplicating its stock).
- **Image upload:** the first image uploaded for an item is automatically `isPrimary: true`; uploading subsequent images does not change the primary unless the user explicitly marks a different one via `PATCH /items/:id/images/:imageId/primary`. Deleting the current primary image, if other images exist, promotes the next-oldest remaining image to primary automatically rather than leaving the item with no primary image.
- Bulk import: validate every row before committing any; return a per-row error report (`{row: 5, error: "duplicate SKU"}`) rather than partial success.

### Acceptance Criteria
- [ ] Cannot create two items with the same SKU in the same outlet
- [ ] Cannot set `minStock >= maxStock`
- [ ] Deactivating an item with an open PO returns 409, not silent failure
- [ ] `GET /items?belowMinStock=true` returns only items where `currentStock < minStock`
- [ ] Creating an item with `openingStock` produces a real `StockTransaction` (`OPENING_BALANCE`) via the FR-02 service, not a raw `currentStock` write
- [ ] Cloning an item copies master data but never copies SKU or current stock
- [ ] The item detail screen has no "Delete" action anywhere — only "Mark as Inactive" / "Reactivate"
- [ ] Deleting the primary image (when other images exist) automatically promotes another image to primary, never leaving the item with zero primary images while images still exist

---


## FR-02: Stock-In / Stock-Out Transactions

### Data Model
```prisma
enum TransactionType {
  PURCHASE_IN
  OPENING_BALANCE
  TRANSFER_IN
  ADJUSTMENT_IN
  USAGE_OUT
  WASTAGE_OUT
  TRANSFER_OUT
  ADJUSTMENT_OUT
}

model StockTransaction {
  id            String   @id @default(uuid())
  outletId      String
  itemId        String
  item          Item     @relation(fields: [itemId], references: [id])
  type          TransactionType
  quantity      Decimal  @db.Decimal(10,3)   // always positive; direction implied by type
  balanceAfter  Decimal  @db.Decimal(10,3)   // running balance snapshot, immutable
  referenceType String?  // 'PO' | 'GRN' | 'TRANSFER' | 'MANUAL'
  referenceId   String?
  reasonCode    String?  // required for WASTAGE_OUT: 'EXPIRED'|'DAMAGED'|'SPILLED'|'OVER_PREPARED'
  photoUrl      String?
  performedById String
  createdAt     DateTime @default(now())

  @@index([itemId, createdAt])
  @@index([outletId, type])
}
```

### API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/stock-transactions` | Create a stock movement |
| `GET` | `/stock-transactions` | List/filter transactions (`itemId`, `type`, `dateFrom`, `dateTo`) |
| `GET` | `/stock-transactions/:id` | Get single transaction |
| `POST` | `/stock-transactions/:id/photo` | Attach wastage photo (multipart) |

**POST /stock-transactions — Request:**
```json
{
  "itemId": "uuid",
  "type": "WASTAGE_OUT",
  "quantity": 2.5,
  "reasonCode": "EXPIRED",
  "referenceType": "MANUAL"
}
```
**Response 201:** transaction object with `balanceAfter` computed server-side.

### Validation Rules
- `quantity > 0` always (direction comes from `type`, never a negative number)
- `reasonCode` required if `type == WASTAGE_OUT`, else must be null
- For any `*_OUT` type: reject if `item.currentStock - quantity < 0`, **unless** requester has `role IN [OUTLET_MANAGER, PROPERTY_MANAGER, CHAIN_OWNER]` and passes `"forceOverride": true` in the body — in which case log an additional `AuditLog` entry with severity `HIGH`

### Business Logic (critical — must run inside a DB transaction)
1. Lock the `Item` row (`SELECT ... FOR UPDATE`) to prevent race conditions on concurrent stock updates.
2. Compute `balanceAfter = currentStock ± quantity` depending on type direction.
3. Insert the `StockTransaction` row (immutable — no `UPDATE`/`DELETE` endpoint ever exposed for this table).
4. Update `Item.currentStock = balanceAfter`.
5. If `balanceAfter < item.minStock`, enqueue a low-stock alert job (see FR-07).
6. Commit. If any step fails, roll back entirely.

### Acceptance Criteria
- [ ] Two concurrent stock-out requests for the same item never result in an incorrect negative balance (test with parallel requests)
- [ ] `WASTAGE_OUT` without `reasonCode` returns `400`
- [ ] Transactions are never editable or deletable via API — corrections only via a new adjustment transaction
- [ ] `balanceAfter` on each row matches a recomputed running sum from full history (data-integrity test)

---

## FR-03: Supplier Management

### Data Model
```prisma
model Supplier {
  id                    String   @id @default(uuid())
  outletId              String
  supplierCode          String?  // short internal reference code (e.g. "SUP-001"), distinct from the internal UUID — for quick reference on printed POs/reports
  name                  String   // legal/trade name
  contactPerson         String?
  phone                 String?
  email                 String?
  addressLine           String?
  city                  String?
  stateOrProvince       String?  // reference info only — see note below on why this doesn't drive automatic GST intra/inter-state logic
  countryCode           String?  // e.g. "SA", "IN", "AE" — ISO 3166-1 alpha-2
  postalCode            String?
  preferredCurrency     String?  // FK-like reference to Currency.code (FR-16) — the currency this supplier typically invoices in; pre-fills PO/GRN currency when this supplier is selected, always overridable per transaction
  taxRegistrationType   String?  // free-text/lookup label, e.g. "GSTIN" (India), "VAT Reg. No." (Saudi/UAE/EU-style), "TRN" (UAE), "NONE" — deliberately not a hardcoded enum, since registration naming varies by country
  taxRegistrationNumber String?  // the actual registration number/ID string — validated only for non-empty format if provided, not checksum-validated against any specific country's rules (that would require per-country validation logic — out of scope for now)
  paymentTerms          String?   // e.g. "NET_15", "NET_30", "COD"
  leadTimeDays          Int?
  bankAccountName       String?  // optional — for accounts-payable reference only; no payment processing happens in-app
  bankAccountNumber     String?
  bankIfscOrSwift       String?  // IFSC (India), SWIFT/BIC (international) — single free-text field, not split by country
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([outletId, isActive])
}

model SupplierPriceHistory {
  id         String   @id @default(uuid())
  supplierId String
  itemId     String
  price      Decimal  @db.Decimal(12,2)
  currencyCode String  @default("SAR")  // the currency this specific price point was recorded in — since a supplier's preferredCurrency can change over time, or a one-off transaction can use a different currency, each history row snapshots its own currency rather than assuming the supplier's current preference retroactively
  recordedAt DateTime @default(now())
  source     String   // 'PO' | 'GRN' | 'MANUAL'

  @@index([supplierId, itemId, recordedAt])
}
```

**On `stateOrProvince` and GST:** this field is captured as **reference information only**, shown on the supplier's profile so the person creating a PO/GRN can see it at a glance and manually pick the correct GST tax rate variant (Intra-state vs. Inter-state, per FR-04's Tax Configuration). It deliberately does **not** drive automatic intra/inter-state tax determination — that would require the outlet's own state to also be captured and compared, plus jurisdiction logic, which remains an explicit, deliberate scope boundary (same reasoning as the Tax Configuration section). Capturing the supplier's state is still worthwhile even without automation — it's the single most useful piece of context for a human making that manual choice correctly.

**On why `SupplierPriceHistory` now carries its own `currencyCode`:** without this, comparing price history across time (or across suppliers) would be misleading if a supplier's currency ever changed, or if a one-off purchase used a different currency than usual — each historical price point needs to stand on its own.

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/suppliers` | Create supplier |
| `GET` | `/suppliers` | List suppliers |
| `GET` | `/suppliers/:id` | Detail incl. performance summary |
| `PATCH` | `/suppliers/:id` | Update |
| `DELETE` | `/suppliers/:id` | Soft delete |
| `GET` | `/suppliers/:id/price-history?itemId=` | Price trend for an item |
| `GET` | `/suppliers/:id/performance` | On-time %, price consistency score |

### Business Logic
- `SupplierPriceHistory` rows are auto-created (never manually) whenever a GRN (FR-04) is finalized — this is the data source for AI-09 (Supplier Price Intelligence). Each row captures the currency actually used for that specific transaction, not assumed from the supplier's current `preferredCurrency`.
- **Selecting a supplier on a PO or Direct GRN pre-fills the currency field from that supplier's `preferredCurrency`** (if set) — always editable per transaction, exactly like tax rate pre-fill from Item defaults; a supplier's usual currency is a convenience default, never a locked constraint.
- Performance score formula (documented for whoever builds AI-09, but computed here as a simple baseline):
  `onTimeRate = COUNT(GRNs received on/before PO expectedDeliveryDate) / COUNT(total GRNs)`
- `DELETE /suppliers/:id` → `409` if any `PurchaseOrder.status NOT IN [Closed, Cancelled, Rejected]` references it.
- `taxRegistrationNumber` has no format/checksum validation beyond "non-empty if provided" — validating GSTIN checksums, VAT number formats, etc. per-country is explicitly out of scope; this is a free-text reference field, not a verified legal identifier.

### Acceptance Criteria
- [ ] Price history entry is created automatically on GRN finalization, never manually editable, and correctly records the currency used for that specific transaction
- [ ] Deleting a supplier with an open PO returns 409
- [ ] Selecting a supplier with a `preferredCurrency` set pre-fills that currency on a new PO/Direct GRN, but the user can still change it before saving
- [ ] A supplier can be saved with `taxRegistrationType`/`taxRegistrationNumber` fully optional — neither is required to create a supplier, since some small local suppliers may not be tax-registered at all
- [ ] The supplier detail screen displays `stateOrProvince` clearly, since it's the key piece of context a user needs to manually pick the correct GST tax rate variant on a PO/GRN for that supplier

---

## FR-04: Purchase Order & Approval Workflow

### Data Model
```prisma
enum POStatus {
  DRAFT
  PENDING_APPROVAL
  APPROVED
  SENT_TO_SUPPLIER
  PARTIALLY_RECEIVED
  FULLY_RECEIVED
  CLOSED
  REJECTED
  CANCELLED
}

model PurchaseOrder {
  id                  String   @id @default(uuid())
  outletId            String
  supplierId          String
  status              POStatus @default(DRAFT)
  expectedDeliveryDate DateTime?
  createdById         String
  approvedById        String?
  approvedAt          DateTime?
  currencyCode        String   @default("SAR")   // ISO 4217, e.g. SAR, AED, USD, INR
  exchangeRateToBase  Decimal  @db.Decimal(12,6) @default(1)  // rate at time of PO creation, vs outlet's base currency — user-editable inline on the form, per the UX enhancement above
  isTaxInclusive      Boolean  @default(false)   // "Item Rates Are: Tax Exclusive/Inclusive" toggle — affects how every line's price is interpreted, see Business Logic
  discountAmount      Decimal  @db.Decimal(12,2) @default(0)  // optional manual reduction — included in totalValue, shown as its own labeled line
  otherChargesAmount  Decimal  @db.Decimal(12,2) @default(0)  // optional manual addition (rounding, freight, misc.) — included in totalValue, shown as its own labeled line
  subtotal            Decimal  @db.Decimal(12,2)  // sum of line amounts before tax
  taxAmount           Decimal  @db.Decimal(12,2)  // sum of line tax amounts
  totalValue          Decimal  @db.Decimal(12,2)  // subtotal + taxAmount - discountAmount + otherChargesAmount, in currencyCode
  lines               POLine[]
  createdAt           DateTime @default(now())
}

model POLine {
  id                String  @id @default(uuid())
  purchaseOrderId   String
  itemId            String
  orderedQty        Decimal @db.Decimal(10,3)
  expectedPrice     Decimal @db.Decimal(12,2)   // unit price, excl. tax, in PO currency
  taxRateId         String?
  taxRate           Decimal @db.Decimal(5,2) @default(0)   // percentage, e.g. 15.00 for 15% VAT, or 18.00 for a compound GST rate — snapshotted at line creation
  lineSubtotal      Decimal @db.Decimal(12,2)   // orderedQty * expectedPrice
  lineTaxAmount     Decimal @db.Decimal(12,2)   // lineSubtotal * taxRate / 100
  lineTotal         Decimal @db.Decimal(12,2)   // lineSubtotal + lineTaxAmount
  receivedQty       Decimal @db.Decimal(10,3) @default(0)
  taxComponents     POLineTaxComponent[]   // populated only if the applied TaxRate was compound (e.g. CGST+SGST); empty for a simple flat-rate tax
}

model POLineTaxComponent {
  id            String  @id @default(uuid())
  poLineId      String
  componentName String  // e.g. "CGST", "SGST", "IGST" — snapshotted from TaxRateComponent.componentName at the time
  componentRate Decimal @db.Decimal(5,2)   // snapshotted rate, e.g. 9.00
  componentAmount Decimal @db.Decimal(12,2)  // computed amount for this component on this line — sum of all components equals POLine.lineTaxAmount

  @@index([poLineId])
}

model GRN {
  id              String   @id @default(uuid())
  outletId        String
  purchaseOrderId String?  // nullable — a GRN can exist WITHOUT a PO (see "Direct GRN" below)
  supplierId      String   // always required, whether or not a PO exists — if purchaseOrderId is set, this must match the PO's supplierId; if not, chosen directly on the GRN
  receivedById    String
  receivedAt      DateTime @default(now())
  currencyCode    String   // inherited from PO if linked, otherwise chosen directly on the GRN
  exchangeRateToBase Decimal @db.Decimal(12,6)   // user-editable inline on the form, per the UX enhancement above
  isTaxInclusive  Boolean  @default(false)   // "Item Rates Are: Tax Exclusive/Inclusive" toggle — inherited from the PO if linked, otherwise set directly
  discountAmount  Decimal @db.Decimal(12,2) @default(0)  // optional manual reduction — included in totalValue
  otherChargesAmount Decimal @db.Decimal(12,2) @default(0)  // optional manual addition (rounding, freight, misc.) — included in totalValue
  subtotal        Decimal  @db.Decimal(12,2)
  taxAmount       Decimal  @db.Decimal(12,2)   // 0 if no tax applied at all — tax is optional, see Business Logic
  totalValue      Decimal  @db.Decimal(12,2)   // subtotal + taxAmount - discountAmount + otherChargesAmount
  invoiceNumber   String?  // supplier's invoice/bill reference number, entered manually or extracted via scan
  invoiceScanUrl  String?  // object-storage URL of the uploaded/scanned invoice image, if provided
  invoiceScanStatus String? // 'NONE' | 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'FAILED' — tracks AI-04 OCR extraction state
  lines           GRNLine[]
  varianceFlagged Boolean  @default(false)

  @@index([outletId, receivedAt])
  @@index([supplierId])
}

model GRNLine {
  id            String  @id @default(uuid())
  grnId         String
  itemId        String
  orderedQty    Decimal? @db.Decimal(10,3)   // nullable — no "ordered" quantity exists for a Direct GRN with no PO
  receivedQty   Decimal @db.Decimal(10,3)
  actualPrice   Decimal @db.Decimal(12,2)   // unit price, excl. tax, as per supplier invoice
  taxRateId     String?  // nullable — tax is entirely optional per line, see Business Logic
  taxRate       Decimal @db.Decimal(5,2) @default(0)
  lineSubtotal  Decimal @db.Decimal(12,2)
  lineTaxAmount Decimal @db.Decimal(12,2)   // 0 when no tax rate is applied
  lineTotal     Decimal @db.Decimal(12,2)
  taxComponents GRNLineTaxComponent[]   // populated only if the applied TaxRate was compound; empty for a simple flat-rate tax
}

model GRNLineTaxComponent {
  id            String  @id @default(uuid())
  grnLineId     String
  componentName String  // e.g. "CGST", "SGST", "IGST" — snapshotted from TaxRateComponent.componentName at the time
  componentRate Decimal @db.Decimal(5,2)
  componentAmount Decimal @db.Decimal(12,2)  // sum of all components equals GRNLine.lineTaxAmount

  @@index([grnLineId])
}

model TaxRate {
  id          String   @id @default(uuid())
  outletId    String
  name        String    // e.g. "VAT 15%", "GST 18% (Intra-state)", "GST 18% (Inter-state)", "Zero-Rated"
  ratePercent Decimal   @db.Decimal(5,2)   // the total/effective rate — for compound rates, this equals the sum of all component rates, and is what's actually used to compute lineTaxAmount
  isCompound  Boolean   @default(false)   // true for split taxes (GST-style); false for a simple single-rate tax (VAT-style)
  isDefault   Boolean   @default(false)   // reserved for future use — see existing note; no functional effect on auto-applying tax
  isActive    Boolean   @default(true)
  countryCode String?   // e.g. "SA", "AE", "IN" — for country-appropriate default suggestion
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  components  TaxRateComponent[]   // empty for isCompound: false; 1+ rows for isCompound: true

  @@index([outletId, isActive])
}

model TaxRateComponent {
  id           String  @id @default(uuid())
  taxRateId    String
  taxRate      TaxRate @relation(fields: [taxRateId], references: [id])
  componentName String // e.g. "CGST", "SGST", "IGST" — free text, not a hardcoded enum, so this isn't India-specific at the schema level (e.g. Canada's GST+PST could use the same mechanism)
  componentRate Decimal @db.Decimal(5,2)   // e.g. 9.00 — components must sum to exactly the parent TaxRate.ratePercent

  @@index([taxRateId])
}

model Currency {
  code          String   @id   // ISO 4217, e.g. "SAR", "AED", "USD"
  name          String
  symbol        String
  decimalPlaces Int      @default(2)
}

model ExchangeRate {
  id            String   @id @default(uuid())
  baseCurrency  String
  targetCurrency String
  rate          Decimal  @db.Decimal(12,6)
  effectiveDate DateTime @default(now())
  source        String   // 'MANUAL' | 'API' (e.g. synced from an FX rate provider)

  @@index([baseCurrency, targetCurrency, effectiveDate])
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/purchase-orders` | Create PO (status=DRAFT) |
| `PATCH` | `/purchase-orders/:id/submit` | DRAFT → PENDING_APPROVAL |
| `PATCH` | `/purchase-orders/:id/approve` | → APPROVED (role: OUTLET_MANAGER/PROPERTY_MANAGER/CHAIN_OWNER only) |
| `PATCH` | `/purchase-orders/:id/reject` | → REJECTED, requires `reason` |
| `PATCH` | `/purchase-orders/:id/send` | → SENT_TO_SUPPLIER |
| `POST` | `/purchase-orders/:id/grn` | Create GRN against this PO (full or partial) |
| `POST` | `/grn/direct` | Create a **standalone GRN with no linked PO** — supplier chosen directly, no ordered-quantity variance check applies |
| `POST` | `/grn/:id/scan-invoice` | Upload a photo/PDF of the supplier invoice (multipart) — triggers AI-04 OCR extraction (see Business Logic) |
| `GET` | `/grn/:id/scan-status` | Poll extraction status while OCR processing is in progress |
| `GET` | `/purchase-orders` | List, filter by `status`, `supplierId`, `dateRange` |
| `GET` | `/purchase-orders/:id` | Detail incl. GRN history |

**POST /purchase-orders — Request:**
```json
{
  "supplierId": "uuid",
  "currencyCode": "SAR",
  "expectedDeliveryDate": "2026-08-01",
  "lines": [
    { "itemId": "uuid", "orderedQty": 20, "expectedPrice": 87.00, "taxRateId": "uuid-vat-15" }
  ]
}
```
Server computes and returns: `lineSubtotal`, `lineTaxAmount`, `lineTotal` per line, and PO-level `subtotal`, `taxAmount`, `totalValue`. If `currencyCode` differs from the outlet's base currency, `exchangeRateToBase` is fetched from the latest `ExchangeRate` row and snapshotted onto the PO (not recalculated later, so historical POs remain accurate even if rates move).

**POST /purchase-orders/:id/grn — Request:**
```json
{
  "currencyCode": "SAR",
  "lines": [
    { "itemId": "uuid", "orderedQty": 20, "receivedQty": 18, "actualPrice": 87.00, "taxRateId": "uuid-vat-15" }
  ]
}
```

**POST /grn/direct — Request** (no PO — e.g., a walk-in market purchase, or a supplier delivery with no prior order):
```json
{
  "supplierId": "uuid",
  "currencyCode": "SAR",
  "invoiceNumber": "INV-88213",
  "lines": [
    { "itemId": "uuid", "receivedQty": 5, "actualPrice": 92.00, "taxRateId": null }
  ]
}
```
Note `orderedQty` is simply absent from a Direct GRN line — there's nothing to compare received-vs-ordered against, so the variance-tolerance check (see Business Logic) does not apply to Direct GRNs at all, only to PO-linked ones. `taxRateId: null` is valid — tax is optional per line (see Business Logic).

**POST /grn/:id/scan-invoice — Request:** multipart file upload (image or PDF of the supplier invoice).
**Response 202** (processing is asynchronous, not synchronous with the upload):
```json
{ "grnId": "uuid", "scanStatus": "PROCESSING" }
```
**GET /grn/:id/scan-status — Response once complete:**
```json
{
  "scanStatus": "EXTRACTED",
  "extractedData": {
    "invoiceNumber": "INV-88213",
    "supplierNameGuess": "Al-Fahad Trading",
    "lines": [
      { "itemNameGuess": "Basmati Rice", "quantity": 20, "unitPrice": 87.00, "matchedItemId": "uuid-or-null" }
    ]
  }
}
```
The frontend uses `extractedData` to **pre-fill** the GRN form — the user always reviews and confirms every field before submission; extracted data is never auto-submitted directly to `POST /grn/direct` or the PO-linked GRN endpoint without human confirmation. `matchedItemId` is null when the OCR'd item name couldn't be confidently matched to an existing `Item` — in that case the line is shown unmatched and the user picks the correct item manually (or creates a new one). This endpoint is the concrete implementation of the SDLC document's **AI-04 (Invoice/Bill OCR Auto-Entry)** feature; the underlying OCR call itself is an external vision/document-AI service, swapped in behind this endpoint rather than built from scratch.

### Additional Endpoints — Tax & Currency
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/tax-rates` | List tax rates for the outlet (filter: `isActive`) |
| `POST` | `/tax-rates` | Create a tax rate (role: PROPERTY_MANAGER/CHAIN_OWNER) |
| `PATCH` | `/tax-rates/:id` | Edit a tax rate's name/percentage (role: PROPERTY_MANAGER/CHAIN_OWNER) |
| `DELETE` | `/tax-rates/:id` | Deactivate a tax rate (soft — sets `isActive: false`, never hard-deleted, consistent with the Item/Category deactivation pattern) |
| `GET` | `/currencies` | List supported currencies |
| `GET` | `/exchange-rates?base=&target=` | Latest exchange rate |
| `POST` | `/exchange-rates` | Manually record/update a rate (or synced nightly from an FX API — see Business Logic) |

### Tax Configuration Screen — Standalone Management, Shared Across Item/PO/GRN

Tax rates are **outlet-level shared reference data**, managed from their own dedicated screen (accessible from Settings, alongside Category management) rather than being buried inside any single feature — the same relationship Category management already has to the Item screen.

**Two kinds of tax rate, both managed from the same screen:**
- **Simple** (`isCompound: false`) — a single flat percentage. Covers most countries: Saudi/UAE VAT, most sales-tax jurisdictions. This is the only kind the original version of this spec supported.
- **Compound** (`isCompound: true`) — a total rate made up of two or more named components that must sum to it. This is required for **India's GST**, which splits the same overall rate differently depending on whether a transaction is intra-state or inter-state:
  - "GST 18% (Intra-state)" → components: CGST 9% + SGST 9%
  - "GST 18% (Inter-state)" → components: IGST 18% (a single component, still modeled as "compound" for consistency, even though it's only one line)

  **This system does not attempt to automatically detect intra- vs. inter-state** (that would require state-level address data on both the outlet and every supplier, plus jurisdiction logic — a real scope increase). Instead, **both variants are simply offered as separate selectable tax rates**, and the person creating the PO/GRN — who already knows whether this particular supplier is in the same state — picks the correct one manually, exactly the same way they'd pick between any two tax rates. This is a deliberate, pragmatic scope boundary: it gets GST correct on the invoice/document without requiring an address/jurisdiction engine.

**Screen — Add/Edit Tax Rate form:**
- Name, overall rate percentage — same as before, for a Simple rate.
- A toggle: "This is a compound tax (e.g., GST with CGST/SGST/IGST)." When enabled, the form reveals a repeatable **components** section — each with its own name (free-text, e.g. "CGST") and rate percentage. The overall `ratePercent` field becomes **read-only, auto-computed as the sum of the components** (rather than entered separately and risking a mismatch) — this removes an entire class of data-entry error, since the total can never silently disagree with its parts.
- List view: name, rate percentage, an indicator badge for compound rates (e.g., a small "CGST+SGST" or "Split" tag) so it's visually obvious at a glance which rates are simple vs. compound, active/inactive status, edit/deactivate actions per row.

**Where it's consumed:**
- **Item Master (FR-01):** the item's optional `defaultTaxRateId` dropdown, pre-filling PO/GRN lines for that item
- **Purchase Orders (FR-04):** each PO line's `taxRateId` selector
- **GRN — all three creation flows (FR-04):** each GRN line's `taxRateId` selector, whether pre-filled from a PO, entered manually on a Direct GRN, or reviewed/confirmed after invoice-scan extraction
All three consume the exact same `GET /tax-rates` list — there is only one tax-rate configuration per outlet, not separate ones per screen.
- **Wherever a PO/GRN line's tax is displayed** (the form itself, any printed/exported document, the Net/Tax/Gross summary): if the applied tax was compound, show the **itemized component breakdown** (e.g., "CGST 9%: SAR 18.00" / "SGST 9%: SAR 18.00"), not just a single lumped "Tax: SAR 36.00" line — for GST this itemization is a standard invoicing expectation, not a nice-to-have. For a simple tax rate, display exactly as before (a single tax line).

**Country-aware default seeding — correcting an earlier gap:** the outlet-creation seeding logic (the same `outlet.created` event mechanism used for default Categories) must seed **starter tax rates appropriate to the outlet's country**, not the same Saudi-centric set (VAT 15%/Zero-Rated/Exempt) for every outlet regardless of location. Use the outlet's `Currency`/locale to infer a reasonable starting country (e.g., `SAR` → Saudi Arabia → seed VAT 15% + Zero-Rated; `INR` → India → seed the common GST slabs — e.g., "GST 5%," "GST 12%," "GST 18%," "GST 28%" — each as a compound rate with both an Intra-state (CGST+SGST split) and Inter-state (IGST) variant; `AED` → UAE → seed VAT 5%). This is a lookup table of standard rates per country, not a hardcoded single default — extensible the same way the `Currency`/`Language` registries are, so adding a new country's standard rates later is a data addition, not a code change.

**Business Rules:**
- **A compound tax rate's components must sum exactly to its `ratePercent`** — validated on save; reject with a clear error if they don't (e.g., "Components sum to 17.50%, but the tax rate is 18.00% — adjust the components to match").
- Deactivating a tax rate does not affect any historical PO/GRN line that already used it — those lines (and their `taxComponents`, if compound) retain their snapshotted values independently of whether the `TaxRate` row is later deactivated or edited. Only *new* selections are affected.
- Editing a tax rate's `ratePercent` or its components only affects **future** lines — it does not retroactively recalculate any already-saved PO/GRN line's `lineTaxAmount` or `taxComponents`, since those were computed and snapshotted at the time of that transaction.
- `ratePercent` (and each component's rate) must be `>= 0` and `<= 100`.
- Cannot deactivate the last remaining *active* tax rate if doing so would leave the outlet with zero active rates — not a hard block, just a confirmation warning, since "no active tax rates" is a valid state but worth flagging in case it's accidental.

### Acceptance Criteria (Tax Configuration)
- [ ] Tax rates are managed from one standalone screen, not duplicated or reconfigured separately per feature
- [ ] A compound tax rate (e.g., GST) can be created with two or more named components, and the overall rate is auto-computed as their sum, never entered independently
- [ ] Saving a compound tax rate whose components don't sum to the stated overall rate is rejected with a clear error
- [ ] Applying a compound tax rate to a PO/GRN line produces itemized component amounts (`POLineTaxComponent`/`GRNLineTaxComponent`), and the line/document display shows each component separately (e.g., "CGST 9%, SGST 9%"), not a single lumped tax figure
- [ ] Both an Intra-state (CGST+SGST) and Inter-state (IGST) variant are available as separate selectable tax rates for an Indian-locale outlet — the system does not attempt automatic state detection
- [ ] Default tax-rate seeding on outlet creation is country-appropriate (e.g., an INR-currency outlet seeds GST slabs with Intra/Inter-state variants, not a Saudi VAT set)
- [ ] The same tax-rate list populates the dropdown identically on Item Master, PO lines, and all three GRN creation flows
- [ ] Deactivating a tax rate removes it from future dropdown selections but does not alter any historical PO/GRN line (or its component breakdown) that already used it
- [ ] Editing a tax rate's percentage or components does not retroactively change any already-saved transaction's tax amount

### GRN Creation Flows — Three Entry Paths, One Screen

The GRN screen supports exactly three ways to start creating a GRN. All three converge on the same review-and-confirm form and the same underlying `GRN`/`GRNLine` records — they differ only in **how the form gets pre-filled**, not in what gets saved.

**Flow 1 — Direct GRN (no PO):** User selects a supplier directly, then manually adds line items (item, quantity, price), with tax optionally applied per line. Uses `POST /grn/direct`. No ordered-quantity comparison applies, since nothing was pre-ordered.

**Flow 2 — Against a PO:** User selects an open PO (filtered to `APPROVED`, `SENT_TO_SUPPLIER`, or `PARTIALLY_RECEIVED` status, for that PO's supplier). Selecting the PO **auto-populates the GRN's lines** from `POLine` — item, ordered quantity, expected price, and tax rate all carry over as defaults. The user then adjusts **received quantity** (may differ from ordered), and can either **accept the tax/price carried over from the PO** or **override it** per line (e.g., the supplier's actual invoice shows a different price or tax treatment than originally quoted) — both are valid; the GRN's saved values are whatever the user confirms, whether that's the PO's defaults untouched or an explicit override. Uses `POST /purchase-orders/:id/grn`.

**Flow 3 — Scan Invoice:** User uploads a photo/PDF of the supplier's invoice. OCR extraction (`POST /grn/:id/scan-invoice`) attempts to identify: **the vendor** (fuzzy-matched against existing `Supplier` records — if matched, pre-selected; if not confidently matched, the user is prompted to pick or create the supplier, since a GRN can never be saved without one), **line items** (fuzzy-matched against `Item` records the same way items are matched — see below), and **tax details**, if the invoice shows any. All of this pre-fills the same review form as Flows 1/2 — nothing is ever saved automatically from a scan. A scanned invoice can be used to create either a Direct GRN or, if the user recognizes it corresponds to an existing PO, linked to that PO instead (the user makes this choice after reviewing the extracted data, before confirming).

**Hard rule across all three flows: a GRN can never be saved without a supplier.** This isn't just a UI validation — `GRN.supplierId` is a required, non-nullable field at the schema level (see Data Model above), so it's enforced server-side regardless of which of the three flows was used to get there.

**GRN amount display — Net, Tax, and Gross, shown clearly on both the line level and the GRN total:**
- **Net Amount** = `subtotal` (sum of line amounts before tax)
- **Tax Amount** = `taxAmount` (sum of line tax amounts — `0` if no tax was applied to any line, per the optional-tax rule above)
- **Gross Amount** = `totalValue` (`subtotal + taxAmount`) — this is the final payable amount
These three figures must always be visibly labeled as **Net / Tax / Gross** on the GRN screen (not just "Subtotal/Tax/Total," to match standard invoicing terminology suppliers and accountants expect), both as a running total at the top/bottom of the GRN form and, where space allows, per line.

### GRN Entry Screen — Making All Three Flows Visible

The `/grn` screen's "New GRN" entry point must present **all three creation flows as explicit, visible options** — not just supported behind the scenes. Concretely, arriving at "New GRN" (whether from the GRN screen's own "+ New GRN" button, or from a PO detail page's "Create GRN" button) presents three clear choices, e.g. as three cards or a segmented control:

1. **"Against a Purchase Order"** — opens the PO picker (Flow 2)
2. **"Direct Entry (No PO)"** — opens the manual supplier + line-item form (Flow 1)
3. **"Scan Invoice"** — opens the file upload for OCR extraction (Flow 3)

If a GRN is started from a PO's detail page specifically, option 1 is pre-selected with that PO already chosen (skipping the picker step), but options 2 and 3 remain visible and selectable — the user isn't locked into the entry point they came from. **Scan Invoice must never be a hidden or secondary feature** — it's one of the three primary, equally-weighted ways to start a GRN, matching AI-04 in the SDLC document's list of market-differentiating AI features. Burying it as a small link or an afterthought button undersells a feature that's meant to be a selling point.

### PO & GRN Document Actions — Print & Email

A Purchase Order exists to be **sent to a supplier** — it isn't useful sitting only inside the app. Both PO and GRN need real document output, not just on-screen viewing.

**API Endpoints:**
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/purchase-orders/:id/pdf` | Generate and return a formatted PDF of the PO (letterhead-style: outlet/chain branding, supplier details, line items, Net/Tax/Gross, terms) |
| `POST` | `/purchase-orders/:id/send-email` | Email the PO PDF to the supplier |
| `GET` | `/grn/:id/pdf` | Generate and return a formatted PDF of the GRN (goods-received document) |
| `POST` | `/grn/:id/send-email` | Email the GRN PDF to a recipient (supplier, for delivery confirmation, or an internal accounts/finance address) |

**POST /purchase-orders/:id/send-email — Request:**
```json
{
  "toEmail": "supplier@example.com",
  "ccEmails": ["accounts@myoutlet.com"],
  "subject": "Purchase Order PO-2026-0142 from Jeddah Hotel — Main Restaurant",
  "message": "Please find attached our purchase order. Kindly confirm receipt."
}
```
`toEmail` defaults to the supplier's `email` field (FR-03) if set, but is always editable before sending — the user isn't locked into what's on file. If the supplier has no email on record and none is provided, the request is rejected with a clear validation error rather than silently failing.

**Screens:**
- **Print button** (in the PO/GRN detail view's action bar, alongside the existing Edit/status actions): generates the **real formatted PDF** via `GET /:id/pdf` and opens it in a new tab / triggers a download — this is a proper generated document, not just the browser's native "print this webpage" function, which would print the app's UI chrome (sidebar, header, etc.) rather than a clean business document.
- **Email button**: opens a compose modal — recipient (pre-filled from supplier email, editable), CC, subject (pre-filled with a sensible default), message body, and a preview/attachment indicator showing the PDF that will be sent. Sending calls `POST /:id/send-email`; success/failure is confirmed in the UI, and a successful send is logged to the Activity Log (FR-18) — "PO-2026-0142 emailed to supplier@example.com."
- Both actions are available regardless of PO status, though emailing a `DRAFT` PO should show a mild confirmation ("This PO hasn't been approved yet — send anyway?") since sending an unapproved order to a supplier is usually a mistake, not a deliberate action.

**Business Logic:**
- PDF generation happens server-side (not a frontend print-to-PDF hack), using the same design-token branding (logo, colors) established in FR-17, so the document looks like it came from a professional system.
- Email sending goes through the same notification infrastructure described in FR-07 (Alerts) — a swappable provider interface, not hardcoded to one email service.
- Every successful `send-email` call is recorded, including timestamp and recipient, viewable from the PO/GRN detail screen (e.g., "Last sent: 21 Jul 2026, 3:40 PM to supplier@example.com") — so it's always clear whether and when a document was actually sent, not just that the button exists.

### Acceptance Criteria (GRN Entry Screen & Document Actions)
- [ ] The "New GRN" screen presents all three creation flows as equally visible, primary options — none is hidden, secondary, or harder to discover than the others
- [ ] Starting a GRN from a PO's detail page pre-selects the "Against a PO" flow with that PO chosen, but the other two flows remain reachable from the same screen
- [ ] `GET /purchase-orders/:id/pdf` and `GET /grn/:id/pdf` produce a real, formatted business document — not a browser print of the app's UI
- [ ] Emailing a PO/GRN defaults the recipient to the supplier's email on file, but allows editing it before sending
- [ ] Attempting to email with no valid recipient email (none on file, none provided) is rejected with a clear error, not a silent failure
- [ ] A successful email send is recorded and visibly shown on the PO/GRN detail screen (timestamp + recipient), and produces an Activity Log entry
- [ ] Emailing a `DRAFT` (unapproved) PO shows a confirmation prompt before sending

### PO & GRN Screen Structure and UX Enhancements

**Screen structure — confirming GRN is standalone:** the GRN screen lives at its own route/section in the app (e.g., `/grn`), separate from the Purchase Order screen (`/purchase-orders`) — it is never just a tab or modal buried inside a PO. A GRN can be *entered from* a PO's detail page (a "Create GRN" button that pre-selects that PO for Flow 2), but the GRN screen itself always supports starting fresh via any of the three flows (Direct / Against PO / Scan Invoice), independent of where the user navigated from.

**Enhancements adopted for both PO and GRN forms, based on common invoicing-software UX patterns:**

- **Inline, editable exchange rate display** — whenever the document's currency differs from the outlet's base currency, show the rate directly at the top of the form (e.g., "1 EUR = 3.75 SAR") with an inline edit affordance, rather than only storing `exchangeRateToBase` silently in the background. Editing it here updates the rate used for *this document's* base-currency conversion; it does not retroactively change the `ExchangeRate` reference table's history unless the user explicitly also updates that (a separate, clearly distinct action).
- **"Item Rates Are: Tax Exclusive / Tax Inclusive" toggle**, set once per document (PO or GRN), affecting how every line's entered price is interpreted:
  - **Tax Exclusive** (the default, and everything described elsewhere in this FR assumes this): `lineSubtotal = qty * price`, tax is added on top.
  - **Tax Inclusive**: the entered `price` already includes tax — the system must reverse-calculate: `lineSubtotal = lineTotal / (1 + ratePercent/100)`, `lineTaxAmount = lineTotal - lineSubtotal`, where `lineTotal = qty * price` (the price as entered). This matters because some suppliers quote inclusive prices — getting this wrong silently overcharges or undercharges tax on every line.
  - This toggle only makes sense when at least one line has a tax rate applied — if no tax is applied at all on the document, exclusive/inclusive is moot.
- **Current stock shown inline in the item picker**, when adding a line — e.g., "Current stock: 12.5 kg" displayed next to the item once selected, so the person creating the PO/GRN can see at a glance whether they're about to order something already well-stocked, without leaving the form to check.
- **Document-level Discount and Other Charges fields** (optional, separate from tax and from each other) — Discount is a manual reduction; Other Charges covers rounding, freight, or miscellaneous fees that don't belong to any specific line. Both default to 0.00. Discount is subtracted and Other Charges is added into the Gross Amount total; each is shown as its own labeled line in the Net/Tax/Discount/Other Charges/Gross summary (e.g., "Net: X, Tax: Y, Discount: -D, Other Charges: C, Gross: X+Y-D+C") — collapsed/hidden when its value is 0, to avoid clutter in the common case where neither applies.
- **Currency shown as a small badge next to the supplier selector**, immediately visible once a supplier is chosen (pre-filled from the supplier's `preferredCurrency`, per FR-03), rather than only appearing once the user scrolls to a separate currency field.

### Business Logic
**Note:** approval-threshold comparison always converts `totalValue` to the outlet's base currency using the PO's snapshotted `exchangeRateToBase`, so thresholds stay consistent regardless of which currency a supplier bills in.
- **Tax calculation is entirely optional, per line (server-side, never trusted from client):**
  1. For each line: `lineSubtotal = orderedQty (or receivedQty for Direct GRN) * price` (adjusted per the Tax Exclusive/Inclusive toggle above).
  2. If `taxRateId` is provided: look up its `ratePercent`; `lineTaxAmount = round(lineSubtotal * ratePercent / 100, 2)`; `lineTotal = lineSubtotal + lineTaxAmount`.
  3. **If `taxRateId` is omitted or explicitly `null`, the line is untaxed** — `taxRate: 0`, `lineTaxAmount: 0`, `lineTotal = lineSubtotal`. This is a valid, first-class state, not an error — many items/suppliers are legitimately tax-exempt or the outlet may not track tax at the line level at all. Do **not** silently fall back to the outlet's default tax rate when `taxRateId` is omitted — that "apply default if missing" behavior from earlier in this FR is replaced by this simpler rule: no `taxRateId` means no tax, full stop. (This supersedes the earlier "apply the outlet's default TaxRate" fallback described below — tax must be an explicit, deliberate choice per line, not an assumed default.)
  4. PO/GRN-level `subtotal = SUM(lineSubtotal)`, `taxAmount = SUM(lineTaxAmount)`, `totalValue = subtotal + taxAmount`.
  5. Reject with `400` only if a **provided** `taxRateId` references an inactive or non-existent tax rate — omitting it entirely is never an error.
- **Direct GRN (no PO):** created via `POST /grn/direct` with `supplierId` chosen directly. There is no `orderedQty` to compare against, so the variance-tolerance check below **does not apply** — a Direct GRN is, by definition, "whatever was actually received," not a check against an order. It still creates `StockTransaction` (`PURCHASE_IN`) and `SupplierPriceHistory` rows exactly like a PO-linked GRN, and still participates fully in FR-18 logging.
- **On PO-linked GRN creation:**
  1. For each line, validate `receivedQty <= (orderedQty - alreadyReceivedQty)`.
  2. If `abs(receivedQty - orderedQty) / orderedQty > toleranceConfig` (default 10%) → set `varianceFlagged = true` and require `OUTLET_MANAGER`-or-higher approval before proceeding (`403` for `STORE_STAFF` role attempting to finalize a variance GRN).
  3. Create a `StockTransaction` (`type: PURCHASE_IN`) per line via the FR-02 service — never write to `Item.currentStock` directly here. Stock quantity is unaffected by currency/tax — only the value fields are.
  4. Create a `SupplierPriceHistory` row per line (`source: 'GRN'`), storing `actualPrice` in the GRN's currency plus its base-currency equivalent (`actualPrice * exchangeRateToBase`) so cross-supplier price comparisons (AI-09) remain valid even when suppliers invoice in different currencies.
  5. Update `POLine.receivedQty`. Recompute PO status: all lines fully received → `FULLY_RECEIVED`; some received → `PARTIALLY_RECEIVED`.
- PO can be manually moved to `CLOSED` from `PARTIALLY_RECEIVED` (accepting short delivery as final) by OUTLET_MANAGER, PROPERTY_MANAGER, or CHAIN_OWNER.
- **Invoice scanning (AI-04):**
  1. `POST /grn/:id/scan-invoice` accepts the uploaded file, stores it (object storage), sets `invoiceScanStatus: 'UPLOADED'`, then dispatches to an OCR/document-AI service asynchronously (`PROCESSING`).
  2. On completion, extracted line items are fuzzy-matched against existing `Item` records by name/SKU where possible (`matchedItemId`); unmatched lines are returned as-is for manual mapping. Status becomes `EXTRACTED`, or `FAILED` with a reason if the scan couldn't be processed (blurry image, unsupported format, etc.).
  3. **Extracted data always pre-fills the GRN form for human review — it is never submitted directly.** The user can edit any extracted field (quantity, price, matched item, tax) before confirming. This matches the SDLC document's stated design principle for AI features generally: recommend and pre-fill, never auto-commit financial/stock data without a human confirming it.
  4. Invoice scanning is available for **both** PO-linked and Direct GRNs — it doesn't require a PO to exist.
- **Exchange rate sourcing:** for MVP, rates are entered manually by PROPERTY_MANAGER/CHAIN_OWNER (simple table, updated as needed). Phase 2+ can sync nightly from an FX rate API (e.g., exchangerate.host) into the `ExchangeRate` table via a scheduled job — the PO/GRN creation logic doesn't change either way, it just reads the latest row.

### Acceptance Criteria (GRN additions)
- [ ] A GRN can be created with no linked Purchase Order (`POST /grn/direct`), with the supplier chosen directly on the GRN itself
- [ ] Selecting a PO on the GRN screen auto-populates all its lines (item, ordered qty, expected price, tax) as editable defaults — the user can accept them as-is or override any field before confirming
- [ ] A line with no `taxRateId` produces a valid, untaxed line (`lineTaxAmount: 0`) — this is never rejected as invalid, and no default tax rate is silently applied
- [ ] A line with an invalid/inactive `taxRateId` is rejected with `400`; omitting `taxRateId` entirely is never rejected
- [ ] Direct GRNs never trigger the PO variance-tolerance check, since there is no ordered quantity to compare against
- [ ] Uploading a supplier invoice via `POST /grn/:id/scan-invoice` produces extracted data — vendor, items, and tax if present — that pre-fills but never auto-submits the GRN form; the user must explicitly confirm before the GRN is created, including explicitly confirming or selecting the vendor if it wasn't confidently matched
- [ ] Invoice scanning works identically whether or not the GRN is linked to a PO
- [ ] **A GRN cannot be saved without a supplier, under any of the three creation flows** — enforced at the API/schema level, not just as a frontend form validation
- [ ] The GRN screen clearly displays **Net Amount, Tax Amount, and Gross Amount** using those exact labels, both as running totals and (where space allows) per line
- [ ] GRN is reachable as its own standalone screen/route, not only as a modal launched from a PO's detail page
- [ ] The exchange rate is visibly displayed and editable inline on the PO/GRN form whenever the document currency differs from the outlet's base currency
- [ ] Setting a document to "Tax Inclusive" correctly reverse-calculates `lineSubtotal`/`lineTaxAmount` from the entered price, rather than adding tax on top of it
- [ ] The item picker shows the selected item's current stock level inline, without requiring navigation away from the PO/GRN form
- [ ] A document-level Discount and/or Other Charges amount, if entered, is correctly included in the Gross Amount and shown as its own labeled line in the Net/Tax/Discount/Other Charges/Gross summary — hidden when zero

### Acceptance Criteria (Tax & Currency additions)
- [ ] Tax amounts are always computed server-side from `taxRateId`, never accepted as a raw number from the client
- [ ] A PO raised in a foreign currency snapshots its exchange rate at creation time; later changes to `ExchangeRate` do not retroactively alter historical PO values
- [ ] Approval-threshold comparisons correctly convert to base currency before comparing
- [ ] Supplier price history remains comparable across suppliers billing in different currencies

### Acceptance Criteria
- [ ] A `STORE_STAFF` cannot approve a PO regardless of value
- [ ] GRN receipt beyond the ordered quantity is rejected at the API level
- [ ] Variance beyond tolerance blocks finalization until an OUTLET_MANAGER-or-higher confirms
- [ ] Every finalized GRN line results in exactly one `StockTransaction` and one `SupplierPriceHistory` row

---

## FR-05: Recipe / BOM Mapping

### Data Model
```prisma
model MenuItem {
  id        String   @id @default(uuid())
  outletId  String
  name      String
  isActive  Boolean  @default(false) // cannot activate without a recipe (see business logic)
  recipes   Recipe[]
}

model Recipe {
  id           String   @id @default(uuid())
  menuItemId   String
  version      Int      @default(1)
  isCurrent    Boolean  @default(true)
  lines        RecipeLine[]
  createdAt    DateTime @default(now())
}

model RecipeLine {
  id           String  @id @default(uuid())
  recipeId     String
  itemId       String?       // raw material item
  subRecipeId  String?       // OR a sub-recipe (mutually exclusive with itemId)
  quantity     Decimal @db.Decimal(10,4)
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/menu-items` | Create menu item |
| `POST` | `/menu-items/:id/recipes` | Create/replace recipe (auto-versions) |
| `GET` | `/menu-items/:id/recipes/current` | Active recipe |
| `GET` | `/menu-items/:id/recipes/history` | All versions |
| `PATCH` | `/menu-items/:id/activate` | Mark sellable (validates recipe exists) |
| `GET` | `/menu-items/:id/cost` | Computed recipe cost from current ingredient prices |

### Business Logic
- Creating a new recipe for a menu item sets the previous one `isCurrent=false` and increments `version` — **never overwrite** an existing recipe row (past sales must remain costed against the version active at time of sale; the `Sale` record stores `recipeVersionUsed`).
- Each `RecipeLine` must have exactly one of `itemId` or `subRecipeId` set (`400` if both or neither).
- Recursive sub-recipe resolution: cost/consumption calculation must detect and reject circular sub-recipe references (`A contains B contains A`) at save time.
- `PATCH /menu-items/:id/activate` → `409` if no recipe exists.

### Acceptance Criteria
- [ ] Editing a recipe creates a new version; old version remains queryable
- [ ] Circular sub-recipe reference is rejected with a clear error, not an infinite loop
- [ ] Cannot activate a menu item with zero recipe lines

---

## FR-06: Auto Stock Deduction on POS Sale

### Data Model
```prisma
model Sale {
  id               String   @id @default(uuid())
  outletId         String
  menuItemId       String
  quantitySold     Decimal  @db.Decimal(10,3)
  recipeVersionUsed Int
  posReferenceId   String   @unique   // idempotency key from POS system
  isVoid           Boolean  @default(false)
  saleTimestamp    DateTime
  createdAt        DateTime @default(now())
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/pos-webhook/sale` | Inbound webhook from POS on each sale (HMAC-signed) |
| `POST` | `/pos-webhook/void` | Inbound webhook on sale void/refund |
| `POST` | `/sales/manual` | Manual entry fallback (no POS integration for outlet) |
| `GET` | `/sales` | List/filter sales |

**POST /pos-webhook/sale — Request:**
```json
{
  "posReferenceId": "pos-txn-88213",
  "menuItemId": "uuid",
  "quantitySold": 2,
  "timestamp": "2026-07-20T12:34:00Z"
}
```

### Business Logic
1. **Idempotency:** if `posReferenceId` already exists, return `200` without reprocessing (POS webhooks may retry).
2. Look up `MenuItem.recipes` current version. If none exists → log a `RecipeMissingWarning` event (surfaces in an admin "unmapped items" queue) and skip stock deduction — **do not fail the webhook** (POS must not see errors for a data-mapping gap).
3. If recipe exists: for each `RecipeLine`, create a `StockTransaction` (`type: USAGE_OUT`, `quantity: recipeLine.quantity * quantitySold`, `referenceType: 'SALE'`, `referenceId: sale.id`) via the FR-02 service. If a line references a sub-recipe, resolve recursively.
4. On `/pos-webhook/void`: locate original `Sale` by `posReferenceId`, mark `isVoid=true`, and create reversing `StockTransaction`s (`type: ADJUSTMENT_IN`) for each ingredient.

### Acceptance Criteria
- [ ] Replaying the same webhook payload twice does not double-deduct stock
- [ ] A sale for a menu item with no recipe does not throw a 5xx — it succeeds and logs a mapping warning
- [ ] Voiding a sale correctly reverses all ingredient deductions, including sub-recipe items

---

## FR-07: Low-Stock & Expiry Alerts

### Data Model
```prisma
enum AlertType { LOW_STOCK, OUT_OF_STOCK, EXPIRY_WARNING }
enum AlertStatus { OPEN, ACKNOWLEDGED, RESOLVED }

model Alert {
  id          String   @id @default(uuid())
  outletId    String
  itemId      String?
  type        AlertType
  status      AlertStatus @default(OPEN)
  message     String
  createdAt   DateTime @default(now())
  resolvedAt  DateTime?

  @@index([outletId, status])
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/alerts` | List (`status`, `type`, `outletId`) |
| `PATCH` | `/alerts/:id/acknowledge` | Mark acknowledged |
| `PATCH` | `/alerts/:id/resolve` | Mark resolved |
| `POST` | `/alerts/:id/create-po-draft` | Shortcut: creates a DRAFT PO pre-filled with this item |

### Business Logic
- Alert generation runs as an **async job** triggered by the FR-02 transaction service (not synchronously in the request path) — publish an event (`item.stock.changed`) to a queue (e.g., BullMQ/Redis) consumed by an `AlertsProcessor`.
- **Dedup rule:** before creating a new `LOW_STOCK` alert for an item, check for an existing `OPEN` alert of the same type for that item created within the last `alertCooldownHours` (default 24) — if found, skip.
- Expiry check runs as a nightly scheduled job: for items with `shelfLifeDays` set, estimate expiry from last `PURCHASE_IN` transaction date + shelf life, and raise `EXPIRY_WARNING` if within `expiryAlertLeadDays` (default 3) of that date.
- Delivery: on alert creation, dispatch to configured channels per `User.notificationPreferences` (push via FCM/APNs, SMS via Twilio, email digest batched hourly).

### Acceptance Criteria
- [ ] No duplicate OPEN alert for the same item+type within the cooldown window
- [ ] Alert creation is decoupled from the stock-transaction request (doesn't slow down FR-02 API response time)
- [ ] `create-po-draft` produces a DRAFT PO with the correct item and a suggested quantity (`maxStock - currentStock`)

---

## FR-08: Multi-Outlet Transfer & Consolidated Dashboard

### Data Model
```prisma
enum TransferStatus { REQUESTED, IN_TRANSIT, RECEIVED, CANCELLED }

model StockTransfer {
  id              String   @id @default(uuid())
  sourceOutletId  String
  destOutletId    String
  status          TransferStatus @default(REQUESTED)
  requestedById   String
  lines           TransferLine[]
  dispatchedAt    DateTime?
  receivedAt      DateTime?
}

model TransferLine {
  id         String  @id @default(uuid())
  transferId String
  itemId     String
  quantity   Decimal @db.Decimal(10,3)
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/transfers` | Create transfer request (role: OUTLET_MANAGER/PROPERTY_MANAGER/CHAIN_OWNER only) |
| `PATCH` | `/transfers/:id/dispatch` | → IN_TRANSIT, creates `TRANSFER_OUT` at source |
| `PATCH` | `/transfers/:id/receive` | → RECEIVED, creates `TRANSFER_IN` at destination |
| `GET` | `/dashboard/outlet/:outletId` | Single-outlet dashboard |
| `GET` | `/dashboard/property/:propertyId` | Aggregated across all outlets in a property |
| `GET` | `/dashboard/chain/:chainId` | Aggregated across all properties/outlets in a chain |

### Business Logic
- `POST /transfers` → `403` if requester's effective role for the source outlet is `STORE_STAFF` or `CHEF` (per FR-11). A transfer between outlets under different properties requires the requester to have at least `PROPERTY_MANAGER`-or-higher effective access covering **both** outlets (i.e., typically a `CHAIN_OWNER`, since a `PROPERTY_MANAGER` scoped to one property normally can't also reach an outlet in another property) — reject with `403` and a clear "insufficient access to destination outlet" message otherwise.
- `dispatch`: creates `StockTransaction(type: TRANSFER_OUT)` at source outlet via FR-02 service (subject to same negative-stock guard).
- `receive`: creates `StockTransaction(type: TRANSFER_IN)` at destination outlet. Quantity received can differ from dispatched (damage in transit) — capture `actualReceivedQty` per line and flag variance similarly to GRN.
- `/dashboard/property/:id` and `/dashboard/chain/:id` aggregate via a read-optimized query (consider a materialized view or scheduled rollup table if outlet count/data volume grows, to avoid heavy real-time joins across many outlets); figures spanning outlets with different `baseCurrency` values are converted to the property's or chain's reporting currency per FR-16, clearly labeled as FX-converted.

### Acceptance Criteria
- [ ] STORE_STAFF and CHEF cannot create a transfer (403)
- [ ] A transfer across properties is blocked unless the requester's access spans both outlets
- [ ] Dispatching decrements source stock; receiving increments destination stock; these are two independent StockTransaction rows, both auditable
- [ ] Property-level dashboard figures equal the sum of its outlets' figures; chain-level figures equal the sum of its properties' figures (reconciliation test at both levels)

---

## FR-09: Barcode / QR Scanning

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/items/lookup-barcode/:code` | Resolve barcode → item (used by mobile scan flow) |
| `POST` | `/items/:id/generate-qr` | Generate a printable internal QR code for items without a manufacturer barcode |

### Business Logic
- `GET /items/lookup-barcode/:code` → `404` if not found; mobile client then routes to "Create new item" pre-filled with the scanned code as `barcode`.
- QR generation: encode `{"itemId": "...", "outletId": "..."}` as JSON payload inside the QR (not just the raw SKU) so scanning is unambiguous across outlets sharing similar SKUs.
- Mobile scan integration is client-side (device camera + a barcode-reading library such as `react-native-vision-camera` + `ml-kit`/`zxing`); backend only needs the lookup/generate endpoints above.

### Acceptance Criteria
- [ ] Scanning a known barcode pre-fills the stock-transaction item field within the app (client-side, verified via lookup endpoint response time < 300ms)
- [ ] Scanning an unknown barcode routes to item creation, not a dead-end error

---

## FR-10: Reporting Suite

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/reports/stock-valuation` | `?outletId=&asOfDate=` |
| `GET` | `/reports/consumption-trend` | `?itemId=&dateFrom=&dateTo=&groupBy=day\|week` |
| `GET` | `/reports/wastage-log` | `?dateFrom=&dateTo=&reasonCode=` |
| `GET` | `/reports/supplier-performance` | `?supplierId=` |
| `GET` | `/reports/purchase-vs-consumption` | `?itemId=&dateFrom=&dateTo=` |
| `GET` | `/reports/:reportType/export?format=pdf\|xlsx` | Export any of the above |
| `POST` | `/reports/schedule` | Configure recurring email delivery |

### Business Logic
- All report queries should run against **read replicas** if available at scale, to avoid impacting transactional write performance.
- For MVP scale (small hotels/restaurants), direct queries against the primary DB with appropriate indexes are acceptable; revisit read-replica routing only if latency degrades.
- Export: generate PDF via a templating engine (e.g., Puppeteer/Playwright rendering an HTML template) and XLSX via a library like `exceljs`; both queued as async jobs with a "ready for download" notification for large exports (>1000 rows), synchronous for small ones.
- Scheduled reports: stored as a `ReportSchedule` record (cron expression, recipient list, report type + filters), processed by a scheduler (e.g., NestJS `@Cron` or a dedicated worker).

### Acceptance Criteria
- [ ] Stock valuation report total matches `SUM(currentStock * costPrice)` recomputed independently (reconciliation test)
- [ ] Export endpoints return a downloadable file link, not raw binary blocking the request
- [ ] Scheduled report actually fires and delivers on the configured cadence in a staging test

---

## FR-11: Role-Based Access Control

### Data Model
Roles and access grants now live in `UserAccess` (see FR-00) rather than a flat field on `User`. This section documents enforcement, not the schema again.

### Implementation Approach
- Use NestJS **Guards** + a custom `@Roles(Role.PROPERTY_MANAGER, Role.CHAIN_OWNER)` decorator on controller methods — every endpoint in this document that mentions a role restriction should be enforced via this guard, checked against `req.effectiveRole` for the specific resource's outlet (resolved per FR-00), not ad-hoc `if` checks scattered in services.
- Field-level restriction (e.g., hiding `costPrice` from `CHEF` role): implement via a response-serialization interceptor that strips restricted fields based on `request.effectiveRole` for the resource in question, rather than building separate DTOs per role (keeps it maintainable as fields grow). Note a user's role can differ per outlet/property, so this check must use the role effective *for that specific resource*, not a single global role on the user.
- Every mutating endpoint must write an `AuditLog` entry: `{userId, action, entityType, entityId, outletId, before, after, timestamp}`.

### Permission Matrix (authoritative reference for the guard config)

| Action | CHAIN_OWNER | PROPERTY_MANAGER | OUTLET_MANAGER | STORE_STAFF | CHEF |
|---|---|---|---|---|---|
| View items | ✅ (all) | ✅ (own property) | ✅ (own outlet) | ✅ | ✅ (no cost price) |
| Create/edit items | ✅ | ✅ | ✅ | ❌ | ❌ |
| Stock in/out entry | ✅ | ✅ | ✅ | ✅ | ✅ (usage/wastage only) |
| Create PO | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve PO | ✅ | ✅ (below threshold) | ✅ (below threshold) | ❌ | ❌ |
| Create transfer | ✅ (any outlets in chain) | ✅ (within own property) | ❌ | ❌ | ❌ |
| View financial reports | ✅ (chain-wide) | ✅ (property-wide) | ✅ (own outlet) | ❌ | ❌ |
| Manage properties/outlets | ✅ | ✅ (edit own property's outlets only) | ❌ | ❌ | ❌ |
| Manage users/roles | ✅ (any scope) | ✅ (within own property only) | ❌ | ❌ | ❌ |
| Set chain-wide 2FA policy | ✅ | ❌ | ❌ | ❌ | ❌ |

### Acceptance Criteria
- [ ] Every endpoint listed with a role restriction in this document actually enforces it, resolved per-resource via `effectiveRole` (integration test matrix covering all 5 roles × key endpoints × at least one cross-property/cross-chain negative test)
- [ ] `costPrice` and valuation fields never appear in API responses served to `CHEF` role
- [ ] Every mutating call produces exactly one AuditLog row, including the `outletId` it applies to
- [ ] A PROPERTY_MANAGER's elevated access does not leak into a sibling property under the same chain

---

## FR-12: Offline Mode with Sync-on-Reconnect

### Client-Side Approach (mobile app)
- Local embedded DB: **WatermelonDB** or **RxDB** (both designed for offline-first sync with a server) storing a cached copy of `Item` master data and a write-ahead queue of pending `StockTransaction` creations.
- Each locally-created transaction gets a **client-generated UUID** and a `syncStatus: 'PENDING' | 'SYNCED' | 'CONFLICT'` flag, plus a `clientCreatedAt` timestamp (distinct from server `createdAt`) to preserve true ordering.

### API Endpoint
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/stock-transactions/sync-batch` | Accepts an array of queued offline transactions, processes in `clientCreatedAt` order |

**Request:**
```json
{
  "transactions": [
    { "clientId": "uuid-a", "itemId": "uuid", "type": "USAGE_OUT", "quantity": 1.5, "clientCreatedAt": "2026-07-20T09:00:00Z" }
  ]
}
```
**Response:** per-transaction result — `{"clientId": "uuid-a", "status": "SYNCED", "serverId": "..."}` or `{"clientId": "uuid-a", "status": "CONFLICT", "reason": "would result in negative stock", "currentServerStock": 3.0}`.

### Business Logic
- Process the batch sequentially per item (same row-locking approach as FR-02) in `clientCreatedAt` order.
- If a transaction would cause negative stock upon replay (because server-side stock diverged while offline), **do not silently force it through and do not silently drop it** — mark `CONFLICT` and surface it in a Manager review queue (`GET /stock-transactions/conflicts`) for manual resolution (accept as override, adjust quantity, or discard).
- Successfully synced transactions are permanently written as normal `StockTransaction` rows (same table/service as FR-02) — offline sync is not a separate data model, just a deferred-write path into the same one.

### Acceptance Criteria
- [ ] Transactions sync in the order they were created offline, not the order the network happened to deliver them
- [ ] A sync that would cause negative stock is flagged as CONFLICT, not silently blocked or silently forced
- [ ] Manager conflict-resolution queue correctly shows all CONFLICT-status items with enough context (item, quantity, server stock at sync time) to resolve them

---

## FR-13: Authentication & Login (with Two-Factor Authentication)

### Data Model
```prisma
model User {
  id                String   @id @default(uuid())
  email             String   @unique
  phone             String?
  passwordHash      String
  preferredLanguage String   @default("en")   // 'en' | 'ar'
  preferredCurrency String   @default("SAR")
  isActive          Boolean  @default(true)
  lastLoginAt       DateTime?
  createdAt         DateTime @default(now())
  // role is no longer a flat field — see FR-00 UserAccess for per-scope role assignment
  twoFactor         TwoFactorAuth?
}

enum TwoFactorMethod { TOTP, SMS, EMAIL }

model TwoFactorAuth {
  id              String   @id @default(uuid())
  userId          String   @unique
  isEnabled       Boolean  @default(false)
  method          TwoFactorMethod @default(TOTP)
  totpSecret      String?           // encrypted at rest; only set if method = TOTP
  enforcedByPolicy Boolean @default(false)  // true if CHAIN_OWNER has mandated 2FA for all users in the tenant
  enrolledAt      DateTime?
  backupCodes     TwoFactorBackupCode[]
}

model TwoFactorBackupCode {
  id              String   @id @default(uuid())
  twoFactorAuthId String
  twoFactorAuth   TwoFactorAuth @relation(fields: [twoFactorAuthId], references: [id])
  codeHash        String            // single-use recovery code, hashed
  usedAt          DateTime?
  createdAt       DateTime @default(now())

  @@index([twoFactorAuthId])
}

model TwoFactorChallenge {
  id            String   @id @default(uuid())
  userId        String
  code          String            // hashed OTP, for SMS/EMAIL method
  method        TwoFactorMethod
  expiresAt     DateTime          // short-lived, e.g. 5 minutes
  attemptCount  Int      @default(0)
  consumedAt    DateTime?
}

model TrustedDevice {
  id           String   @id @default(uuid())
  userId       String
  deviceToken  String   @unique   // stored client-side, presented to skip 2FA on "remember this device"
  deviceLabel  String?            // e.g. "Manager's iPhone", "Front Desk PC"
  expiresAt    DateTime           // e.g. 30 days
  createdAt    DateTime @default(now())
}

model RefreshToken {
  id         String   @id @default(uuid())
  userId     String
  tokenHash  String
  expiresAt  DateTime
  revokedAt  DateTime?
  deviceInfo String?
}

model PasswordResetToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Step 1: email/phone + password → either full tokens (if 2FA not required) or a `pendingTwoFactorToken` |
| `POST` | `/auth/2fa/verify` | Step 2: submit OTP/TOTP code + `pendingTwoFactorToken` → access + refresh tokens |
| `POST` | `/auth/2fa/resend` | Resend SMS/email OTP (rate-limited) |
| `POST` | `/auth/2fa/enroll/start` | Begin enrollment — returns TOTP QR/secret, or triggers SMS/email OTP for that method |
| `POST` | `/auth/2fa/enroll/confirm` | Confirm enrollment with a valid code — activates `TwoFactorAuth.isEnabled = true`, generates backup codes |
| `POST` | `/auth/2fa/disable` | Disable 2FA (requires current password + a valid 2FA code as a final check) |
| `POST` | `/auth/2fa/backup-code` | Log in using a backup code instead of the primary method (invalidates that code) |
| `POST` | `/auth/refresh` | Exchange refresh token for new access token |
| `POST` | `/auth/logout` | Revoke refresh token (this device) |
| `POST` | `/auth/logout-all` | Revoke all refresh tokens (all devices) |
| `POST` | `/auth/forgot-password` | Sends reset link/OTP via email/SMS |
| `POST` | `/auth/reset-password` | Consumes reset token, sets new password |
| `GET` | `/auth/me` | Current user profile, including 2FA status and effective role/scope (from FR-00) |

**POST /auth/login — Request:**
```json
{ "email": "manager@hotel.com", "password": "••••••••", "trustedDeviceToken": "optional-stored-token" }
```
**Response 200 (2FA required):**
```json
{
  "requiresTwoFactor": true,
  "pendingTwoFactorToken": "short-lived-opaque-token",
  "method": "TOTP",
  "maskedDestination": null
}
```
**Response 200 (2FA satisfied via trusted device, or not enabled):**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "opaque-token...",
  "expiresIn": 900,
  "user": { "id": "uuid", "preferredLanguage": "ar", "effectiveRole": "OUTLET_MANAGER", "effectiveOutletIds": ["uuid"] }
}
```

**POST /auth/2fa/verify — Request:**
```json
{ "pendingTwoFactorToken": "...", "code": "482913", "trustDevice": true, "deviceLabel": "Front Desk PC" }
```
**Response 200:** same shape as the non-2FA login success response above. If `trustDevice: true`, a `TrustedDevice` row is created and its `deviceToken` returned to the client for storage (e.g., secure cookie or mobile keychain), so future logins from that device can skip the challenge until it expires.

### Screens (Frontend)
- **Login screen:** email/phone + password, "Forgot password?" link, language toggle (EN/AR) visible even before login.
- **2FA challenge screen:** shown immediately after password submit if `requiresTwoFactor: true` — 6-digit code entry, "Resend code" (SMS/email methods only, with cooldown), "Use a backup code instead" link, "Trust this device for 30 days" checkbox.
- **2FA enrollment screen (Settings):** choose method (Authenticator App / SMS / Email), for TOTP show QR code + manual entry key + confirmation code field, then display the one-time list of backup codes with a "download/print" option and an explicit "I've saved these" confirmation before proceeding.
- **2FA management screen:** shows current status (enabled/disabled, method), "Regenerate backup codes," "Disable 2FA" (re-auth required), and — for CHAIN_OWNER — a chain-wide policy toggle "Require 2FA for all users."
- **Forgot/Reset password flow:** unchanged from earlier draft.

### Business Logic
- Passwords hashed with `bcrypt` (cost ≥ 12) or `argon2`. `totpSecret` encrypted at rest (application-level encryption, not just relying on DB-at-rest encryption) since it's a long-lived shared secret.
- **Login flow:**
  1. Validate email + password.
  2. If a valid, non-expired `TrustedDevice` token is presented and matches the user → skip 2FA, issue tokens directly.
  3. Else if `TwoFactorAuth.isEnabled` (or `enforcedByPolicy` at the chain level) → issue a short-lived `pendingTwoFactorToken` (5–10 min, single-use, bound to the userId), dispatch OTP if method is SMS/EMAIL, and respond `requiresTwoFactor: true`. **Do not issue access/refresh tokens at this stage.**
  4. Else → issue tokens directly (2FA not enabled and not enforced).
- **Verify flow:** validate `pendingTwoFactorToken` (not expired, not already consumed), validate the code (TOTP: standard 30-second-window algorithm with ±1 window tolerance; SMS/EMAIL: compare against `TwoFactorChallenge.code` hash, enforce `attemptCount` ≤ 5 before invalidating and requiring a fresh login). On success, consume the token/challenge and issue tokens.
- **Chain-level enforcement:** if a `CHAIN_OWNER` sets `enforcedByPolicy = true`, any user under that chain without `TwoFactorAuth.isEnabled` is required to complete enrollment on next login before reaching the app (a forced enrollment screen, not just a nag) — this should be checked at the `/auth/login` step, returning a distinct `requiresTwoFactorEnrollment: true` response rather than `requiresTwoFactor`.
- **Backup codes:** generated as 10 single-use codes at enrollment, each stored as its own `TwoFactorBackupCode` row (hashed), individually marked `usedAt` on use rather than removed from a list — this also gives a natural audit trail of which backup code was used and when. Regenerating deletes all previous unused rows and inserts a fresh set of 10.
- Rate-limit `/auth/login`, `/auth/2fa/verify`, and `/auth/2fa/resend` independently (e.g., 5 attempts / 15 min per user for verify, to blunt OTP brute-forcing specifically — this is a tighter limit than general login attempts since OTPs are only 6 digits).

### Acceptance Criteria
- [ ] A user with 2FA enabled cannot obtain access/refresh tokens from `/auth/login` alone — tokens are only issued after `/auth/2fa/verify` succeeds (or a valid trusted-device token is presented)
- [ ] TOTP codes validate correctly within the standard time-drift tolerance and reject codes outside it
- [ ] Backup codes are single-use — reusing a consumed backup code fails
- [ ] A CHAIN_OWNER enabling policy-enforced 2FA causes non-enrolled users in that chain to be routed to mandatory enrollment on next login, not silently let through
- [ ] Trusted-device tokens expire and correctly re-trigger the 2FA challenge after expiry
- [ ] Repeated failed 2FA verify attempts trigger rate-limiting/lockout, not unlimited retries
- [ ] Expired/invalid refresh token forces re-login, never silently fails open

---

## FR-14: User Management Screen

### API Endpoints (role: CHAIN_OWNER — full; PROPERTY_MANAGER — scoped to own property, read/invite within it)
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/users` | List users, auto-scoped to caller's `effectiveOutletIds`/properties/chain (see FR-00) |
| `POST` | `/users/invite` | Invite a new user with one or more scope grants (`scopeType` + `scopeId` + `role` per grant) |
| `POST` | `/users/invite/:token/accept` | Invited user sets password (and optionally enrolls 2FA if enforced), account activates |
| `GET` | `/users/:id` | User detail, including all `UserAccess` grants |
| `PATCH` | `/users/:id/access` | Add/remove/update scope grants for a user |
| `DELETE` | `/users/:id` | Deactivate (soft delete — never hard-delete, for audit-trail integrity) |
| `POST` | `/users/:id/reset-password-admin` | Admin-triggered forced password reset |
| `POST` | `/users/:id/reset-2fa-admin` | Admin-triggered 2FA reset (e.g., user lost their device) — requires the acting admin to itself pass a 2FA step, since this is a sensitive override |
| `GET` | `/users/:id/audit-log` | Actions performed by this user |

**POST /users/invite — Request:**
```json
{
  "email": "chef@property1.com",
  "phone": "+9665xxxxxxx",
  "grants": [
    { "scopeType": "OUTLET", "scopeId": "uuid-outlet-1", "role": "CHEF" }
  ]
}
```
A user can be invited with multiple grants at once (e.g., `OUTLET_MANAGER` at two specific outlets, or `PROPERTY_MANAGER` at one property).

### Screens (Frontend)
- **User list screen:** table/card list with name, top-level role summary (e.g., "Property Manager — Jeddah Hotel" or "Chef — Main Restaurant, Pool Bar"), status (Active/Invited/Deactivated), search + scope filter. For a CHAIN_OWNER, this list is chain-wide with a property filter; for a PROPERTY_MANAGER, it's pre-scoped to their property.
- **Invite user screen:** email/phone, then an **access grant builder** — pick scope level (Chain / Property / Outlet), pick the specific entity from a tree selector (using the `/chains/:id/hierarchy` endpoint from FR-00), pick role, with an "add another grant" option for users needing access to multiple outlets/properties.
- **User detail/edit screen:** list of current grants (editable/removable), "add grant" action, deactivate toggle, "view audit log" link, "force password reset" and "reset 2FA" buttons (both requiring the acting admin's own re-authentication).
- **Pending invites view:** shows invited-but-not-yet-activated users with a "resend invite" action.

### Business Logic
- `POST /users/invite`: creates a `User` row with `isActive: false` and no `passwordHash` yet, creates the requested `UserAccess` rows immediately (they simply have no effect until the user activates), generates a signed invite token (expires in 7 days), sends via email/SMS.
- **Grant validation:** the inviting user cannot grant a scope broader than their own effective access — e.g., a `PROPERTY_MANAGER` cannot grant `CHAIN`-scoped access to someone, and cannot grant access to a property other than their own (`403` if attempted).
- Access/role changes via `PATCH /users/:id/access` take effect on the next request (per FR-00's per-request resolution — no forced logout needed) unless an immediate revoke is explicitly required, in which case chain the call with `/auth/logout-all` for that user.
- Deactivating a user does not delete their historical `StockTransaction`, `PurchaseOrder`, or `AuditLog` records — all remain intact with `performedById` pointing to the (now inactive) user, and their `UserAccess` grants are retained but ignored (inactive users always fail auth regardless of grants).
- If the chain has `enforcedByPolicy` 2FA (FR-13) turned on, the invite-acceptance flow routes the new user through mandatory 2FA enrollment before they reach the app for the first time.

### Acceptance Criteria
- [ ] Invited user cannot log in until they complete the accept-invite/set-password flow
- [ ] A PROPERTY_MANAGER cannot grant access outside their own property, even to a user they're inviting fresh (403 on attempt)
- [ ] Deactivating a user preserves all their historical transaction/audit records unchanged, and immediately blocks login regardless of remaining active grants
- [ ] Expired invite tokens are rejected with a clear "invite expired, request a new one" message
- [ ] A user with grants at multiple outlets sees a correct combined `effectiveOutletIds` list reflected in what data they can access

---

## FR-15: Multilingual Support (Localization & RTL), Launching with English, Arabic, Hindi, and Urdu

### Approach
The application is architected for **any number of languages**, not just two — language packs are data-driven (JSON resource files + a `Language` registry table), so adding a new language later is a content/translation task, not a code change. **English, Arabic, Hindi, and Urdu ship at launch** — this set is chosen deliberately for the actual target market: small hotel/restaurant back-of-house staff in the Gulf region commonly include South Asian kitchen/store workers alongside Arabic- and English-speaking management, so these four give real day-one usability rather than just an English tool with an Arabic option bolted on. Arabic and Urdu require full **RTL** — right-to-left — layout; English and Hindi are LTR. The architecture remains ready for further languages (e.g., Tagalog/Filipino, French, Spanish) to be added later by dropping in a new resource file and registering it, with no changes to components or business logic.

**What actually gets translated — an important scope boundary:** every **system-generated** piece of text — navigation labels, buttons, form labels, validation messages, alert text, email/SMS notifications, report headers — switches fully and immediately when the user changes language. **User-entered business data does not** — an item name, supplier name, or note typed in by staff is stored and displayed exactly as entered, in whatever language/script it was typed in, regardless of the active UI language. Auto-translating actual business content (e.g., machine-translating "Basmati Rice" into Arabic automatically) is a different capability (real-time machine translation) and is explicitly out of scope for this FR — it could be considered as a future AI-driven feature, but must not be assumed or half-implemented here.

### Data Model
```prisma
model Language {
  code        String   @id   // ISO 639-1, e.g. "en", "ar", "fr", "ur"
  name        String        // native display name, e.g. "العربية" for Arabic
  direction   String        // "ltr" | "rtl"
  isActive    Boolean  @default(true)   // controls whether it's offered in the language switcher
}
```
`User.preferredLanguage` (FR-13) references `Language.code` rather than a hardcoded `'en' | 'ar'` enum, so the field itself never needs a schema change to support a new language.

### Backend
- All user-facing strings generated by the backend (email templates, SMS templates, PDF report labels, alert messages, validation error messages) must be **key-based**, resolved server-side using the requesting user's `preferredLanguage` (or an `Accept-Language` header override), not hardcoded English.
- Structure: `/locales/{languageCode}.json` (e.g., `en.json`, `ar.json`, and any future `fr.json`, `ur.json`, ...) — flat key-value resource files loaded via a library like `i18next` (Node) or NestJS's `nestjs-i18n`. Adding a language is: add the JSON file, insert a `Language` row, done — no controller/service code touches language-specific logic.
- Master/reference data that is inherently user-entered (item names, supplier names, category names) is stored as-is (whatever language the user typed) — **not** auto-translated. Only system-generated UI text, labels, and notifications are localized.
- Numeric/date formatting in server-generated PDFs/exports respects locale (e.g., Arabic-Indic numerals are **not** used by default for Arabic — Gulf-region convention is Western numerals with Arabic labels; this is a configurable per-outlet setting rather than assumed, and the same pattern extends to any future locale's numeral/date conventions).

### Frontend (React / React Native)
- i18n library: `i18next` + `react-i18next` (web) and `i18next` + `react-native-localize` (mobile) — both support an arbitrary number of loaded language packs out of the box, so no rework is needed to go from 2 to 5 languages.
- **Direction handling (not just "Arabic special-cased"):** the app reads `direction` from the `Language` record for the active language and applies it generically — any future RTL language (e.g., Urdu, Hebrew, Farsi) gets correct mirroring automatically, and any future LTR language just works without special-casing.
  - React Native: use `I18nManager.forceRTL(true/false)` and `I18nManager.isRTL`, driven by the selected language's `direction` field; this requires an app reload/restart to fully apply on native — the UI should show a "restart to apply" prompt on language change on mobile, not attempt a silent hot-swap.
  - Web: set `dir="{language.direction}"` on the root `<html>`/container element and use CSS logical properties (`margin-inline-start` instead of `margin-left`, etc.) throughout, or a CSS-in-JS solution with RTL-plugin support (e.g., `stylis-plugin-rtl`), so layout mirrors automatically rather than requiring hand-flipped styles per component.
- **Component-level considerations:**
  - Icons implying direction (back arrows, forward chevrons) must flip whenever `direction === 'rtl'`, for any language, not conditionally on "is it Arabic."
  - Number inputs, date pickers, and currency inputs remain LTR internally even inside an RTL layout (standard convention — numbers read left-to-right regardless of surrounding text direction).
  - Charts/graphs (consumption trends, dashboards) — axis direction and legend placement mirror under RTL for consistency, but this is lower priority than core transactional screens.
- **Language switcher:** presented as a searchable list (not just a 2-way toggle) driven by `GET /languages` (active `Language` rows), available from the Login screen (pre-auth) and from a Settings/Profile screen (post-auth), persisted to `User.preferredLanguage` via `PATCH /users/:id` (self-update allowed for this one field regardless of role).

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/languages` | List active languages for the switcher (code, native name, direction) |
| `POST` | `/languages` | Register a new language (admin/internal use when onboarding a new locale) |

### Acceptance Criteria
- [ ] All four launch languages (English, Arabic, Hindi, Urdu) are fully translated and selectable — not just English with partial translations elsewhere
- [ ] Adding a new language beyond the launch set (e.g., French) requires only a new resource file + a `Language` row — no component or controller code changes
- [ ] Any language flagged `direction: rtl` (Arabic, Urdu) mirrors the entire layout automatically, not just Arabic specifically
- [ ] **The language switcher is available and fully functional on the Login screen, before authentication** — a user can change language before ever signing in, and the Login screen itself (labels, button text, error messages) re-renders fully in the selected language
- [ ] Selecting a different language immediately re-renders **every system-generated caption, label, button, menu item, alert, and message on the current screen and every screen thereafter** — no leftover untranslated strings, and no partial-translation state where some UI elements switch and others don't
- [ ] All system-generated notifications (alerts, PO approval emails, reports) render in the recipient's `preferredLanguage`
- [ ] User-entered business data (item names, supplier names, notes) displays exactly as entered, untranslated, regardless of UI language — this is intentional and must not be "fixed" by adding auto-translation
- [ ] Numbers, dates, and currency amounts remain correctly formatted and left-to-right even within an RTL-rendered screen
- [ ] Missing translation keys fall back to English (never render a raw key like `alert.low_stock.title` to the user) and are logged for translator follow-up

---

## FR-16: Multi-Currency Support

### Approach
Each **outlet** has a configured **base currency** (used for all internal valuation, reporting, and cross-outlet consolidation). Individual transactions (POs, GRNs) can be raised in a **different currency** (e.g., a supplier who invoices in USD while the outlet's base currency is SAR), with amounts stored in both the transaction currency and converted base-currency equivalent.

### Data Model additions
```prisma
model Outlet {
  id            String   @id @default(uuid())
  name          String
  baseCurrency  String   @default("SAR")
  // ...existing fields
}
```
(See FR-04's `Currency` and `ExchangeRate` models above — shared across PO/GRN and any future module needing currency conversion, e.g. multi-outlet consolidated dashboard reporting in a group-level reporting currency.)

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/outlets/:id/currency-settings` | Base currency + supported transaction currencies for this outlet |
| `PATCH` | `/outlets/:id/currency-settings` | Update base currency (CHAIN_OWNER only — see business rule below) |

### Business Logic
- **Base currency changes are heavily restricted:** once an outlet has any `StockTransaction`, `PurchaseOrder`, or `GRN` history, changing `baseCurrency` is blocked by default (`409`) because it would invalidate all historical valuation reporting. If genuinely required (e.g., correcting a setup mistake in month 1), it must go through an explicit "re-base" admin operation that recalculates/relabels historical records — flagged as a rare, manually-supervised operation, not a routine settings change.
- Every value amount stored (`Item.costPrice`, PO/GRN totals, `StockTransaction` — if cost tracking is added there later) should conceptually carry a currency; for MVP, `Item.costPrice` is always in the outlet's base currency (simplifies stock valuation reporting — FR-10), while PO/GRN can be in a foreign currency and are converted to base at GRN finalization for the purpose of updating any base-currency cost references.
- **Consolidated dashboard (FR-08)** across multiple outlets with different base currencies converts each outlet's figures to a configurable **group reporting currency** using the latest `ExchangeRate`, clearly labeling this as a converted/estimated figure (not transactional truth) in the UI.
- Currency formatting on the frontend uses `Intl.NumberFormat(locale, { style: 'currency', currency: code })` so both the numeral formatting and currency symbol placement respect the active language/locale (e.g., symbol placement differs between `en-SA` and `ar-SA` conventions).

### Acceptance Criteria
- [ ] An outlet's base currency cannot be changed via the standard settings endpoint once transactional history exists
- [ ] A PO raised in a non-base currency correctly stores both the original amount and the base-currency equivalent at the snapshotted rate
- [ ] Consolidated multi-outlet dashboard clearly indicates converted figures are FX-estimated, not exact
- [ ] Currency values display with correct symbol and formatting for both English and Arabic locales

---

## FR-17: Design System — Modern, Polished, "Smart" Visual Identity

### Approach
The product's visual quality is a stated market differentiator — it should look like a premium, purpose-built SaaS product, not a generic admin-panel template. This translates into concrete, buildable requirements rather than just an aesthetic aspiration:

### Design Requirements
- **Design tokens, not ad-hoc styling:** a single source of truth for color palette (primary/secondary/accent + semantic colors for success/warning/danger/info), typography scale, spacing scale, border-radius, and shadow levels — implemented as a Tailwind config / CSS variable set, referenced everywhere, never hardcoded hex values or magic-number spacing in components.
- **Distinctive, not templated:** avoid the generic "default Bootstrap/Material admin dashboard" look. Choose a typeface pairing with actual character (not just system-default sans), a considered accent color that shows up consistently (buttons, active states, chart highlights), and purposeful use of whitespace rather than cramming.
- **Dashboard-first visual language:** key screens (Owner/Manager dashboards, outlet/property/chain switcher, alerts panel) use card-based layouts with clear visual hierarchy — the single most important number on any screen (e.g., "3 items below reorder point") should be the most visually prominent element, not buried in a table.
- **Data visualization quality:** charts (consumption trends, forecasts, stock valuation) use a consistent, tasteful color system tied to the same design tokens — not default chart-library rainbow palettes.
- **Micro-interactions:** meaningful transitions and feedback (e.g., a stock-count input that visibly confirms a save, a low-stock alert badge that animates in) rather than static, flat state changes — used sparingly enough that they read as polish, not distraction.
- **Dark mode:** supported from the design-token layer outward (tokens define both light and dark values), since back-of-house staff often work in dim kitchen/storage environments.
- **Consistency across web and mobile:** the React (web) and React Native (mobile) apps share the same design tokens and component design language, so the product feels like one product across devices, not two different apps that happen to share a backend.
- **Fully responsive web app, not just "desktop with a mobile app on the side":** the web app itself must work cleanly across the whole range of screen sizes it'll actually be used at — a manager's desktop back-office PC, a tablet propped up in a kitchen or at a store counter, and a phone browser (for anyone who hasn't installed the PWA yet). This is not the same thing as the separate React Native mobile app — both need to exist, and both need to handle their own range of sizes well.
  - Define a standard set of breakpoints as part of the design-token layer (e.g., `sm` ~640px, `md` ~768px, `tablet` ~1024px, `lg`/desktop ~1280px+) and use them consistently — no screen should hardcode a one-off breakpoint.
  - **Mobile-first CSS**: base styles target the smallest viewport, with `min-width` media queries progressively enhancing the layout for larger screens — not the reverse.
  - Data-dense screens (item lists, PO tables, reports) need an explicit **narrow-viewport strategy** decided per-screen up front (e.g., a table collapsing into stacked cards below `md`, horizontal scroll with sticky key columns, or a simplified column set) rather than just letting a wide table overflow awkwardly.
  - Touch targets (buttons, row actions, form inputs) meet a minimum tappable size (44×44px is the common baseline) on touch-capable viewports, since tablet/phone use in a kitchen or store counter is a real, expected usage pattern here — not an edge case.
  - The chain/property/outlet context switcher (FR-00) and any navigation chrome must have an explicit mobile pattern (e.g., collapsing into a drawer/sheet below `md`) decided as part of this FR, since it appears on every screen.

- **Empty/loading/error states designed, not default:** every list/dashboard screen has a deliberately designed empty state (e.g., first-time "no items yet — add your first item" with an illustration, not a blank table), loading skeleton, and error state — these are disproportionately visible during onboarding and demos, so they matter more than their frequency suggests.

### Implementation Notes
- Use the project's frontend design guidance (design tokens, spacing/typography scale, and component conventions) consistently across every screen built for FR-01 through FR-16 — this FR isn't a separate module to build once, it's a constraint that applies to every screen in every other FR.
- Establish the token set and a small library of core components (button, input, card, badge, modal, table, empty-state) **before** building feature screens, so later FRs consume a consistent component library rather than each screen inventing its own styling.

### Acceptance Criteria
- [ ] No component hardcodes a raw color/spacing value outside the design-token set
- [ ] Every primary dashboard screen has a clear single visual focal point, verifiable by a "does the most important number stand out" review
- [ ] Dark mode renders correctly (contrast-checked) across all core screens, not just a subset
- [ ] Web and mobile apps are visually recognizable as the same product side-by-side
- [ ] Every list/table screen has a designed empty state, not a blank area
- [ ] The web app renders correctly and usably at phone, tablet, and desktop widths using the defined breakpoints — verified by resizing/testing at each breakpoint, not just at one default desktop width
- [ ] Every data-dense screen (item lists, PO tables, reports) has a working narrow-viewport layout, not an overflowing table
- [ ] Interactive elements meet the minimum touch-target size on touch viewports
- [ ] The context switcher and navigation chrome have a working mobile pattern (e.g., drawer/sheet), not just a shrunk desktop layout

---

### Operational UX Standards

This section formalizes the operational/density layer of the design system — distinct from, and layered on top of, the premium visual language (teal/charcoal palette, soft shadows, generous type scale) already established earlier in FR-17. The two are complementary: the *visual quality* stays the same everywhere; *information density* varies by screen type, since a dashboard overview and a data-entry grid have different jobs.

**1. Typography scale** (concrete tokens, not just font family choices):
| Token | Size | Weight | Use |
|---|---|---|---|
| `text-display` | 32px | 700 | Page-level numbers (e.g., Dashboard's focal-point count) |
| `text-h1` | 24px | 700 | Page titles |
| `text-h2` | 18px | 600 | Section headings, card titles |
| `text-body` | 15px | 400 | Default body text |
| `text-body-dense` | 13px | 400 | Dense grid rows (see Grid Standards below) |
| `text-label` | 13px | 500 | Form labels, table headers |
| `text-caption` | 12px | 400 | Timestamps, helper text |

**2. Spacing scale**: 4px base unit — `4, 8, 12, 16, 24, 32, 48, 64px`. Every margin/padding/gap in the codebase uses one of these steps; no arbitrary pixel values.

**3. Operational color-coding strategy** (extends the existing semantic tokens to be used *consistently everywhere status appears*, not just the alert bar):
| Severity | Token | Use |
|---|---|---|
| Critical | `color-severity-critical` (muted red) | Stockout, GRN blocked, security/auth failure |
| Warning | `color-severity-warning` (muted amber) | Low-stock, expiry approaching, pending approval |
| Info | `color-severity-info` (muted blue) | Informational notices, in-progress states |
| Success | `color-severity-success` (muted green — distinct from the teal brand accent, to avoid confusing "brand color" with "success state") | Completed actions, healthy stock levels |
Applied consistently across: alert bar badges, table row status indicators, form validation states, and KPI card accents — one severity vocabulary used everywhere, not re-invented per screen.

**4. Dashboard patterns**: two documented layouts, used per context:
- **Overview dashboard** (e.g., the main Dashboard screen already built) — spacious, focal-point-first, for a manager checking overall health at a glance.
- **Dense operational dashboard** — a denser variant for screens where an operator scans a lot of live data quickly (e.g., a multi-outlet overview for a Property/Chain-level user, or an active-alerts triage view) — more KPIs visible above the fold, tighter card spacing, using `text-body-dense`. Both share the same tokens/colors; only density differs.

**5. Grid/table standards** — a **dense grid variant**, as a sibling to the existing `ResponsiveTable` component (not a replacement — `ResponsiveTable` remains the default for typical lists; the dense variant is opt-in for screens that need it):
- Compact row height (~32px vs. the default's ~48px), `text-body-dense` throughout.
- Sortable column headers, sticky header row on scroll.
- Row hover and keyboard-focus states clearly visible (uses the operational color tokens above for any status column).
- Still respects the narrow-viewport collapse strategy from FR-17's original responsive requirements — a dense grid on desktop still needs a usable mobile fallback.

**6. Keyboard navigation strategy** (extends the `Ctrl+K`/`Esc` shortcuts already built):
- Arrow keys move focus between rows in any data grid (dense or standard); `Enter` opens/activates the focused row; `Space` toggles a checkbox/selection if the grid supports multi-select.
- Tab order follows visual/logical order on every screen — no keyboard traps in modals (the existing Radix-based `Modal` already handles this correctly).
- A visible focus ring (not browser default, but not suppressed either) on every focusable element, using the teal accent token for consistency.

**7. Accessibility standards**:
- Minimum contrast ratio **4.5:1** for body text, **3:1** for large text/icons, checked against both light and dark themes — extends FR-17's existing "dark mode contrast-checked" acceptance criterion to light mode and to the new operational color tokens specifically.
- Every interactive element has an accessible name (via visible label, `aria-label`, or `aria-labelledby`) — icon-only buttons (e.g., print/export/refresh in the Global Actions bar) are not exempt.
- Focus order and focus visibility (point 6 above) count as accessibility requirements, not just a UX nicety.

**8. Document preview pattern** (for document-heavy screens — Purchase Orders, GRNs, report exports): a reusable **split-screen layout** — live document preview on one side, a configuration panel with checkbox toggles for optional fields on the other (settings panel collapses below the preview on narrow viewports). This is the pattern FR-04's PO/GRN screens will use once built; built here as a reusable `DocumentPreviewLayout` component and demonstrated in the Styleguide with a mock document, not tied to any specific screen's real data yet.

### Acceptance Criteria (Operational UX Standards)
- [ ] Typography and spacing scales are implemented as tokens and used everywhere — no arbitrary font-size/spacing values in component code
- [ ] The four operational severity colors are used consistently across alert badges, table status indicators, and form validation — not redefined per screen
- [ ] Both dashboard density patterns exist and are demonstrated in the Styleguide
- [ ] The dense grid variant exists, is keyboard-navigable (arrow keys + Enter), and has a working narrow-viewport fallback
- [ ] Contrast ratios meet the stated minimums in both light and dark themes, verified for the new operational color tokens specifically
- [ ] `DocumentPreviewLayout` component exists and is demonstrated with a mock document in the Styleguide

---

### Global App Chrome — Mandatory Elements on Every Screen

Every screen in the application (web and mobile) shares a persistent shell so users never lose orientation or hunt for common actions — this formalizes the `AppShell`/`NavDrawer`/`ContextSwitcher` components already built in FR-17's foundation. This is especially important for an **operational tool used under time pressure** (a store clerk mid-delivery, a chef mid-service) — every extra click or moment of disorientation has a real cost.

**1. Global Header** — present on every screen:
```
[Chain name] › [Property name] › [Outlet name]   |   [Date/Time]   |   [User name — effective role]
```
- The Chain/Property/Outlet breadcrumb *is* the FR-00 context switcher — tapping any segment opens the switcher for that level (only shown if the user has access to more than one entity at that level; a single-outlet user just sees plain text, not a dead-end dropdown).
- Effective role (e.g., "Ahmed — Outlet Manager") is shown so it's always clear what permission level the current view reflects, especially relevant for a user with different roles at different outlets (FR-00).

**2. Global Search** — present on every screen, scoped to the entities that actually exist in this application:
```
Search: Item | Category | Supplier | Purchase Order | GRN | Transfer | Recipe/Menu Item | User
```
- A single search box with type-ahead, results grouped by entity type, scoped automatically to the user's `effectiveOutletIds` (FR-00) — never surfaces data outside what the user can already access.
- Keyboard shortcut: `/` or `Ctrl+K` (a common, discoverable convention) focuses global search from anywhere.

**3. Global Alert Bar** — present on every screen, reflecting the application's actual alert-worthy states (not generic placeholders):
```
[Low-Stock Items] | [Expiry Warnings] | [Pending PO Approvals] | [GRN Variance Awaiting Sign-off] | [Unacknowledged Alerts]
```
- Sourced directly from FR-07 (Alerts) and FR-04's variance-approval workflow — this bar is a live, filtered view into the same `Alert` records and pending-approval states already modeled there, not a separate system.
- Each badge shows a count and is clickable, jumping straight to the filtered list (e.g., clicking "Pending PO Approvals: 3" goes straight to those 3 POs) — minimizing clicks for an operator under time pressure, per the "ultra-fast operation" requirement.
- Uses the semantic color tokens from FR-17's palette (muted amber for warning-level items like low-stock, muted red for anything requiring immediate action like GRN variance) — consistent with, not separate from, the rest of the design system's color strategy.

**4. Global Actions** — present on every screen (typically top-right):
```
[Print] [Export] [Refresh] [Language: EN/AR ▾] [Help] [Back to Dashboard]
```
- **Print/Export** apply contextually to whatever the current screen shows (e.g., a report screen exports that report; a PO screen prints that PO) — not a generic action with no target.
- **Language switcher** here is the FR-15 language selector, always reachable, not buried in a settings screen.
- **Help** links to in-app contextual guidance for the current screen (tooltip/panel), not just a generic external help link.

### Keyboard-Driven Operation (supplementary to FR-17's component library)
Since store/kitchen staff often need to move fast without reaching for a mouse/trackpad:
- Standardized shortcuts across the app: `/` or `Ctrl+K` (global search), `Esc` (close modal/drawer), `Ctrl+N` (new item/PO/etc., contextual to current screen), arrow keys + `Enter` for dense grid navigation (item lists, PO line items).
- Every dense data grid (item lists, PO/GRN line entry, reports) should support keyboard-only row navigation and inline editing where applicable — this is a natural extension of the `ResponsiveTable` component already built, not a separate component.
- Shortcuts are discoverable via the Help panel (a `?` overlay showing available shortcuts for the current screen is a common, low-effort pattern worth including).

### Acceptance Criteria (Global App Chrome)
- [ ] Every screen in the application renders the same Global Header, Search, Alert Bar, and Actions — no screen is missing any of the four
- [ ] Global Alert Bar counts and Global Search results are correctly scoped to the viewing user's effective access (FR-00) — never leak cross-outlet/property/chain data
- [ ] `Ctrl+K`/`/` opens global search from any screen without needing to click into a search field first
- [ ] Language switcher in Global Actions correctly changes UI language and direction (LTR/RTL) app-wide, consistent with FR-15
- [ ] Clicking any Global Alert Bar badge navigates directly to the correctly filtered underlying list, not a generic alerts page requiring further filtering

---

## FR-18: Activity & Transaction Log (System-Wide)

### Approach
Beyond the per-module `AuditLog` writes already specified in FR-11 (RBAC), the system maintains two complementary, system-wide logs:

- **Activity Log** — a human-readable, chronological feed of **every action any user takes** anywhere in the system: logins, approvals, invites, 2FA changes, creates, edits, deletes — "who did what, when," across every module.
- **Transaction Log** — a **field-level change record** capturing exactly **what changed** during any create/update/delete on a **master data screen** (Item, Category, Supplier, Recipe/Menu Item, Tax Rate, Currency, User, Outlet/Property/Chain settings) or a **transactional screen** (Stock Transaction, Purchase Order, GRN, Transfer, Sale) — the specific field(s), their before-value and after-value, regardless of whether the change carries a monetary amount. Editing a Supplier's phone number, changing an Item's reorder threshold, and receiving a GRN are all Transaction Log entries; none of them need to "have a dollar value" to qualify.

**The distinction in one line:** Activity Log answers "what did Ahmed do at 2:15pm" (an event); Transaction Log answers "what exactly changed on this Item record, and what was it before" (a data diff). Every mutating action produces an Activity Log entry; if that action modified any tracked field on a master or transactional entity, it also produces one or more Transaction Log entries — one per changed field, or one per record with a structured diff, per the model below.

### Data Model
```prisma
enum ActivityCategory { AUTH, USER_MGMT, ITEM, STOCK, SUPPLIER, PURCHASE_ORDER, GRN, TRANSFER, RECIPE, ALERT, REPORT, SETTINGS, TAX_CURRENCY }

model ActivityLog {
  id            String   @id @default(uuid())
  chainId       String
  propertyId    String?
  outletId      String?
  userId        String?           // null for system-generated events (e.g., scheduled AI jobs)
  category      ActivityCategory
  action        String            // e.g. "ITEM_CREATED", "PO_APPROVED", "LOGIN_SUCCESS", "2FA_ENABLED"
  entityType    String?
  entityId      String?
  description   String            // human-readable, localized at render time via a message key, not stored pre-translated
  metadata      String?           // JSON-serialized string (NVARCHAR(MAX)) — SQL Server has no native Json type via Prisma, so serialize/deserialize (JSON.stringify/JSON.parse) at the repository layer
  ipAddress     String?
  deviceInfo    String?
  createdAt     DateTime @default(now())

  @@index([outletId, createdAt])
  @@index([chainId, createdAt])
  @@index([userId, createdAt])
  @@index([category, createdAt])
}

model TransactionLog {
  id             String   @id @default(uuid())
  outletId       String
  entityCategory String   // 'MASTER_DATA' | 'TRANSACTIONAL' — MASTER_DATA: Item, Category, Supplier, Recipe, TaxRate, Currency, User, Outlet/Property/Chain settings. TRANSACTIONAL: StockTransaction, PurchaseOrder, GRN, Transfer, Sale
  entityType     String   // e.g. 'Item', 'Supplier', 'PurchaseOrder', 'StockTransaction'
  entityId       String   // FK to the actual record that changed
  operation      String   // 'CREATE' | 'UPDATE' | 'DELETE'
  fieldName      String?  // the specific field that changed (null for CREATE/DELETE, where the whole record is the "change")
  oldValue       String?  // string-serialized previous value (null for CREATE)
  newValue       String?  // string-serialized new value (null for DELETE)
  valueAmount    Decimal? @db.Decimal(12,2)  // populated only when the change also has a monetary/quantity dimension (e.g., a GRN receipt) — optional enrichment, not the defining criterion for whether an entry exists
  currencyCode   String?
  performedById  String?
  summary        String            // human-readable one-liner, e.g. "Reorder threshold changed from 10 to 15 on Basmati Rice" or "Received 18kg Basmati Rice from Al-Fahad Trading, SAR 1,566.00 incl. tax"
  createdAt      DateTime @default(now())

  @@index([outletId, createdAt])
  @@index([entityType, entityId])
  @@index([entityCategory, createdAt])
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/activity-log` | Filterable feed (`outletId`, `propertyId`, `chainId`, `category`, `userId`, `dateFrom`, `dateTo`) |
| `GET` | `/transaction-log` | Filterable feed of field-level changes on master/transactional data (`outletId`, `entityCategory`, `entityType`, `entityId`, `dateFrom`, `dateTo`) |
| `GET` | `/activity-log/export?format=pdf|xlsx` | Export for compliance/audit purposes |

### Business Logic
- **Every write path in FR-00 through FR-16 emits both:**
  1. The module-specific record already specified (e.g., a `StockTransaction` row, a `POLine`, an `AuditLog` entry per FR-11's mutating-endpoint rule), **and**
  2. A corresponding `ActivityLog` row (always), **and**
  3. One or more `TransactionLog` rows **whenever the action creates, updates, or deletes a master-data or transactional entity** — this is the default for nearly every mutating endpoint in the application, not a special case reserved for financial transactions. Editing an Item's `minStock`, renaming a Supplier, and receiving a GRN all produce TransactionLog rows; the only mutating actions that produce an ActivityLog entry *without* a TransactionLog entry are ones that don't change a tracked entity's data at all (e.g., `LOGIN_SUCCESS`, `LOGOUT`, a report export).
  This is implemented as a single cross-cutting NestJS interceptor/event-listener subscribing to a domain-event bus (e.g., emit `activity.recorded` and `entity.changed` events from each service after a successful write) rather than hand-adding logging calls in every service method — keeps it consistent and impossible to forget in new modules.
- **Diff granularity:** for `UPDATE` operations, emit one `TransactionLog` row per changed field (so a single PATCH that changes both `name` and `minStock` on an Item produces two rows, each with its own `fieldName`/`oldValue`/`newValue`) — this makes the log genuinely useful for "show me every change to this field over time," not just "something changed on this date." For `CREATE`/`DELETE`, a single row is sufficient (`fieldName: null`, with the full record's relevant state summarized in `summary`).
- **Login/auth events** (FR-13): `LOGIN_SUCCESS`, `LOGIN_FAILED`, `2FA_ENABLED`, `2FA_DISABLED`, `PASSWORD_RESET`, `LOGOUT` all produce `ActivityLog` rows with `category: AUTH` (no `TransactionLog` rows, since no master/transactional entity data changed) — this is what lets a Chain Owner later answer "who logged in and when," which is a common security/compliance question.
- **Rendering:** `description` (ActivityLog) and `summary` (TransactionLog) are composed from a message-key + structured data at write time (e.g., `key: "activity.item.created", metadata: {itemName, sku}`) so **both feeds are multilingual** (FR-15) — a Manager viewing in Arabic and an Owner viewing in English see the same event correctly localized, not a frozen English sentence.
- **Retention:** activity/transaction logs are retained indefinitely by default (they're small, append-only rows) but exposed via a configurable archive/export-then-purge policy for chains with strict data-retention requirements — never silently auto-deleted without an explicit chain-level setting.
- **Performance:** high-volume entity types (Item, StockTransaction) should be paginated with cursor-based pagination, not offset pagination, given potentially large row counts at scale, especially since UPDATE now produces one row per changed field.

### Screens (Frontend)
- **Activity feed screen:** chronological, filterable, human-readable feed of user actions (e.g., "Ahmed approved PO #1042" / "أحمد وافق على أمر الشراء #1042") with category icons and a search/filter bar; accessible to OUTLET_MANAGER and above, scoped to their effective outlets per FR-00.
- **Transaction log screen:** a field-level change/audit view — filterable by entity type (Item, Supplier, PO, GRN, etc.) and date range, showing exactly what changed and from/to what value on any master or transactional record; exportable — this is the screen an owner or auditor uses to answer "what happened to this specific record over time."
- Both screens respect the RBAC field-level restrictions from FR-11 (e.g., a CHEF-scoped user, if given any log access at all, would not see cost/value figures).

### Acceptance Criteria
- [ ] Every mutating action anywhere in the system (across all FRs) produces exactly one `ActivityLog` entry, verified via an automated test that exercises each write endpoint and asserts a corresponding log row
- [ ] Every create/update/delete on a master-data entity (Item, Supplier, Category, Recipe, Tax Rate, Currency, User access, Outlet/Property/Chain settings) or transactional entity (StockTransaction, PO, GRN, Transfer, Sale) produces the correct `TransactionLog` row(s) — one per changed field for updates, one row for creates/deletes — **regardless of whether the change carries a monetary value**
- [ ] Actions that don't change any tracked entity (login, logout, report export) correctly produce an `ActivityLog` entry only, with no corresponding `TransactionLog` row
- [ ] Both the activity feed and transaction log render correctly localized regardless of the viewing user's language, without needing separate stored copies per language
- [ ] Activity/transaction log filtering correctly respects the viewer's effective outlet/property/chain scope (FR-00) — a PROPERTY_MANAGER never sees another property's log entries
- [ ] Export produces a complete, correctly formatted file for the filtered range

---

## Suggested Build Order for a Coding Agent

Given dependencies between modules, implement in this order:
1. **Multi-Tenant Hierarchy (FR-00)** — Chain/Property/Outlet models and the `UserAccess` scope-resolution logic; everything else depends on `effectiveOutletIds` being resolvable
2. **Auth & Login incl. 2FA (FR-13)** — nothing else works without this
3. **RBAC (FR-11)** + **User Management (FR-14)** — role guards and the screens to manage them, built on top of FR-00's scope model
4. **Design System foundation (FR-17)** — establish tokens and the core component library before any feature screen is built, so nothing needs restyling later
5. **Localization scaffolding (FR-15)** — set up i18n framework and the `Language` registry early; retrofitting RTL/multilingual later is expensive, so wire this up from the first screen built, even with only English + Arabic content initially
6. **Activity & Transaction Log plumbing (FR-18)** — build the event-emission mechanism (domain event bus / interceptor) now, so every module built afterward emits into it automatically rather than needing retrofitted logging calls
7. **Item Master (FR-01)** — foundational entity
8. **Stock Transactions (FR-02)** — core engine everything else writes through
9. **Currency & Tax configuration (FR-16, tax portion of FR-04)** — set up `Currency`, `TaxRate`, `ExchangeRate` reference data before building PO/GRN
10. **Suppliers (FR-03)** → **Purchase Orders & GRN (FR-04, with tax/currency)**
11. **Recipes/BOM (FR-05)** → **POS Auto-Deduction (FR-06)**
12. **Alerts (FR-07)** — depends on FR-02 event emission
13. **Multi-outlet/Multi-property Transfers (FR-08)**
14. **Barcode Scanning (FR-09)** — mostly client-side, thin backend
15. **Reporting (FR-10)** — read-only, depends on all prior data existing, must respect locale/currency formatting and property/chain-level rollups
16. **Offline Sync (FR-12)** — depends on FR-02 being stable and idempotent

Each numbered item above is sized to be a reasonable single implementation pass (with its own tests) for an agent working sprint-by-sprint, matching the SDLC document's Phase 1/2 breakdown (Section 8).
