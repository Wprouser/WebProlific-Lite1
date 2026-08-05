# Backlog

Known gaps that are real but deliberately not being fixed right now, with enough
context to pick each one up cold. Add to this rather than losing a finding in a
conversation.

---

## GRN does not implement its own spec's "Post Received Items" step

**Logged:** 2026-08-05, while planning FR-06.
**Status:** open — deliberately deferred, not a regression.

**What the spec says.** FR-04 describes GRN receiving as a two-stage action: the
user reviews received lines, sees an **"Inventory Impact preview"** showing what
the receipt will do to stock, and then explicitly commits via **"Post Received
Items"**. FR-06's batch-import Review screen is written as *"mirroring the
'Inventory Impact preview' pattern already established for GRN's 'Post Received
Items'"* — i.e. the spec treats that pattern as existing.

**What the code actually does.** It doesn't exist. There is no draft/posted
distinction on a GRN, no impact preview, and no separate commit step: creating a
GRN writes `StockTransaction` rows immediately. The only thing called a
"preview" in the GRN screens is `previewLineTax` in
`web/src/components/grn/GrnLineItemsEditor.tsx` — a client-side per-line
*tax/total* calculation, unrelated to stock impact.

**Why it matters.** Receiving goods is an irreversible stock movement, and it is
currently committed without the user being shown its inventory consequences
first. That is the same class of risk FR-06's "Run BOM" confirmation is designed
to avoid, and it applies at least as strongly to GRN.

**The plan.** FR-06 builds the server-side impact-preview pattern properly —
projected stock impact has to be computed server-side because it requires full
recursive recipe-tree resolution, which the client cannot do. Once that pattern
is established and proven in FR-06, bring GRN in line with it as its own
follow-up: an explicit preview + "Post Received Items" commit step, reusing the
FR-06 preview shape rather than inventing a second one.

**Scope when picked up:** likely a `status` field on `Grn` (draft vs. posted), a
`GET /grn/:id/impact-preview` endpoint, a commit endpoint, and the corresponding
two-stage UI on the GRN screens. Check FR-04's acceptance criteria for what the
spec actually demands before designing.
