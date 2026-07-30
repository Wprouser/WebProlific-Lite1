// Seeded onto every newly created outlet (see DefaultUnitsListener) — a
// broader starter set than the old 6-value enum it replaces, precisely
// because units are no longer hardcoded: a user can only add a missing one
// (e.g. "Bunch," "Sack," "Tray") via the Unit Management screen, so it's
// worth seeding a genuinely useful default set rather than a bare minimum.
// Also used (as a literal, hand-copied list — migrations can't import
// application code) to backfill this same starter set onto every outlet
// that existed before this table did; see that migration's own comment.
//
// Two tiers, not one flat list — base units must exist (and have real ids)
// before the derived units that reference them can be created, so
// DefaultUnitsListener seeds DEFAULT_BASE_UNITS first, then resolves each
// DEFAULT_DERIVED_UNITS row's baseUnitName to the id just created.
export const DEFAULT_BASE_UNITS = [
  { name: 'Millilitre', abbreviation: 'mL' },
  { name: 'Gram', abbreviation: 'g' },
  { name: 'Piece', abbreviation: 'pc' },
  // Box/Dozen/Pack deliberately have no conversion relationship — their
  // real-world size varies too much per outlet to assume a fixed factor
  // (spec: "conversion support is opt-in per unit family").
  { name: 'Box', abbreviation: 'box' },
  { name: 'Dozen', abbreviation: 'dz' },
  { name: 'Pack', abbreviation: 'pack' },
] as const;

export const DEFAULT_DERIVED_UNITS = [
  { name: 'Litre', abbreviation: 'L', baseUnitName: 'Millilitre', conversionFactor: '1000' },
  { name: 'Kilogram', abbreviation: 'kg', baseUnitName: 'Gram', conversionFactor: '1000' },
] as const;
