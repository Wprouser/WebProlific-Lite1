# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project: WebProlific-Lite — AI Inventory Management System

An AI-powered inventory management system for small hotels and restaurants, built to scale
from a single standalone restaurant up to a multi-property hospitality chain.

## Reference documents (read before implementing anything)
- `docs/SDLC_Document_AI_Inventory_App.md` — business requirements, scope, AI feature roadmap,
  non-functional requirements, phased rollout plan.
- `docs/Technical_Spec_Core_Inventory_Module.md` — the authoritative implementation spec:
  data models (Prisma schema), REST API contracts, validation rules, business logic, and
  acceptance criteria for every functional requirement (FR-00 through FR-18).

**Always consult the Technical Spec before implementing any FR.** It is the source of truth
for schema, endpoints, and business rules. Do not deviate from it without flagging the
deviation and explaining why first.

## Stack
- Backend: Node.js (NestJS) + TypeScript
- Database: SQL Server via Prisma ORM, accessed only through the Repository Pattern
  (see Technical Spec's "SQL Server schema compatibility notes" near the top, and SDLC doc
  §6.2) — this keeps the DB swappable to PostgreSQL or another RDBMS later without an
  application rewrite. Note: Prisma's SQL Server connector has no native `Json` type and no
  scalar array columns — see the compatibility notes before modeling any new field that
  would naturally be JSON or a list (model it as a related table or a serialized `String`
  instead, matching the pattern already used for `TwoFactorBackupCode` and `ActivityLog.metadata`).
- Frontend web: React + Tailwind CSS (PWA-enabled, doubles as the desktop experience)
- Mobile: React Native
- i18n: i18next / react-i18next / react-native-localize (multilingual, RTL-aware — see FR-15)

## Commands

Backend (run from repo root):
- `npm run start:dev` — start Nest API with watch mode
- `npm run build` / `npm run start:prod` — production build/run
- `npm run lint` — ESLint over `src`/`test`, with `--fix`
- `npm test` — Jest unit tests (`*.spec.ts` inside `src/`, colocated with the code)
- `npm test -- <pattern>` — run a single unit test file/suite by name pattern
- `npm run test:watch` / `npm run test:cov`
- `npm run test:e2e` — Jest e2e suite (`test/*.e2e-spec.ts`), uses `test/jest-e2e.json`
- `npm run test:e2e -- -t "<name>"` — run a single e2e spec/describe by name
- `npm run prisma:generate` — regenerate Prisma client after any schema change
- `npm run prisma:migrate:dev` — create/apply a migration against the dev DB
- `npm run prisma:migrate:test` — apply pending migrations to the e2e test DB (`.env.test`)

Database: SQL Server runs via `docker-compose.yml` (`docker compose up -d`). Copy
`.env.example` → `.env` for dev, and `.env.test.example` → `.env.test` for e2e —
**e2e tests run against a separate database** (`test/env-setup.ts` loads `.env.test`
before `AppModule`/`PrismaService` are imported) so test cleanup never touches dev data.

Frontend (run from `web/`):
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run typecheck` — `tsc -b` only
- `npm run lint` — oxlint
- `npm test` — Vitest (single run); `npm run test:watch` for watch mode
- `npx vitest run <path or -t pattern>` — run a single test file or test name

## Architecture

**Backend (`src/`)** is a NestJS modular monolith, one module per FR/domain
(`tenancy`, `auth`, `rbac`, `users`, `activity-log`, `items`, `stock-transactions`,
`tax-rates`, `currencies`, `exchange-rates`, `suppliers`, `purchase-orders`,
`invoice-scans`, `grn`, `storage`), wired together in `src/app.module.ts`. Each module
follows the same internal shape:
- `domain/` — plain entity types
- `dto/` — class-validator request DTOs
- `repositories/` — an abstract repository class per aggregate + a `tokens.ts` exporting
  a `Symbol` injection token for each (interfaces don't exist at runtime, so Nest needs a
  token to bind to); `repositories/prisma/` holds the concrete Prisma implementations.
  Services depend only on the abstract repository via `@Inject(TOKEN)` — **never import
  `PrismaService`/`@prisma/client` directly in a service**. The module's `providers` array
  is what binds `{ provide: TOKEN, useClass: PrismaXxxRepository }`; a module that needs
  another module's repository imports that module and re-exports the token (see
  `ItemsModule` exporting `ITEM_REPOSITORY`/`UNIT_OF_MEASURE_REPOSITORY` for
  `StockTransactionsService`/`PurchaseOrdersService`/`GrnService` to consume).
- `services/` — business logic; `controllers/` — REST handlers; `listeners/` — event
  handlers (e.g. `DefaultCategoriesListener` seeding defaults on property creation).

**Cross-cutting request pipeline** (order matters, registered as global providers in
`AppModule`): `JwtAuthGuard` populates `request.user` → `ScopeResolutionGuard` (FR-00)
resolves `effectiveOutletIds` onto the request → `RolesGuard` (FR-11, driven by the
`@Roles()`/`@ResourceScope()` decorators in `src/rbac/decorators`) authorizes against that
resolved scope → `FieldRestrictionInterceptor` strips fields the caller's role can't see.
Never bypass this by checking `user.role` ad hoc in a service.

**Activity/Transaction logging (FR-18)** is event-driven, not called directly: services
call `ActivityBus.record(event)` (`src/activity-log/services/activity-bus.service.ts`),
which emits an `activity.recorded` event (and an `entity.changed` event when the payload
includes an `entityChange`) via `EventEmitter2`. `ActivityLogListener` and
`TransactionLogListener` (`src/activity-log/listeners/`) are the *only* places that turn
those events into `ActivityLog`/`TransactionLog` rows. `emitAsync` is used deliberately so
tests/requests can rely on the log row existing immediately after a write completes.

**Prisma / SQL Server**: schema lives at `prisma/schema.prisma`. SQL Server's Prisma
connector has no native `Json` type and no scalar array/list columns — model those as a
related table or a serialized `String` (see `TwoFactorBackupCode`, `ActivityLog.metadata`)
instead of reaching for `Json`/`String[]`.

**Frontend (`web/src/`)** is a Vite + React 19 + React Router + Tailwind v4 SPA:
- `routes/` — one file per screen, route-level data fetching
- `components/<domain>/` — feature components (e.g. `items/`, `grn/`, `purchase-orders/`);
  `components/ui/` — the FR-17 design-system primitives (`Button`, `Modal`, `Table`,
  `Select`, etc.); `components/layout/` — app chrome (`AppShell`, `NavDrawer`, `GlobalHeader`)
- `lib/*-api.ts` — one thin fetch-wrapper module per backend resource, all going through
  `lib/api-client.ts`; `lib/auth-store.ts` holds auth/session state
- `theme/ThemeProvider.tsx` — design tokens/theme switching (FR-17)
- `i18n/locales/{en,ar,hi,ur}.json` — translation catalogs (FR-15); Arabic/Urdu are RTL
- Tests are colocated `*.test.tsx`/`*.test.ts` next to the source file, run with Vitest +
  Testing Library.

## Build order — follow this exactly
Per the "Suggested Build Order for a Coding Agent" section at the end of the Technical Spec:
1. FR-00 — Multi-Tenant Hierarchy (Chain → Property → Outlet) + UserAccess scope resolution
2. FR-13 — Auth & Login incl. Two-Factor Authentication
3. FR-11 — RBAC + FR-14 — User Management
4. FR-17 — Design System foundation (tokens + core component library, before any feature screen)
5. FR-15 — Localization scaffolding (i18n + Language registry, EN/AR at launch, RTL-generic)
6. FR-18 — Activity & Transaction Log plumbing (event bus, so every later module logs automatically)
7. FR-01 — Item Master
8. FR-02 — Stock Transactions (the core engine everything else writes through)
9. FR-16 + tax portion of FR-04 — Currency & Tax reference data
10. FR-03 — Suppliers → FR-04 — Purchase Orders & GRN
11. FR-05 — Recipes/BOM → FR-06 — POS Auto-Deduction
12. FR-07 — Alerts
13. FR-08 — Multi-outlet/Multi-property Transfers
14. FR-09 — Barcode Scanning
15. FR-10 — Reporting
16. FR-12 — Offline Sync

**Do not start a later FR until the acceptance criteria of its dependencies are met.**

## Working conventions
- Every FR's acceptance criteria checklist (in the Technical Spec) must pass before that FR
  is considered done. Treat these as the definition of done, not a nice-to-have.
- Write tests alongside each module as it's built, not retrofitted afterward.
- Use the Repository Pattern for all data access — no direct Prisma/ORM calls from services
  (see SDLC doc §6.2 for the rationale — this is what keeps the DB portable).
- Every mutating endpoint must emit an ActivityLog entry (FR-18) and, where it carries a
  monetary/stock value, a TransactionLog entry — via the shared event mechanism, not
  hand-added logging calls per service.
- Role checks go through the RBAC guard (FR-11) resolved against `effectiveOutletIds`
  (FR-00) — never ad-hoc `if (user.role === ...)` checks scattered in services.
- All amounts: `Decimal(12,2)`. All quantities: `Decimal(10,3)`.
- Follow FR-17's design-token approach for every screen — no hardcoded colors/spacing.

## Before writing code on any new FR
Read the relevant FR section in the Technical Spec in full, then give a short implementation
plan (files to create/modify, order of operations) before writing code, so it can be checked
against the spec first.
