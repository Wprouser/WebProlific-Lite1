/**
 * Mock data for FR-17's demonstration surfaces (AppShell/ContextSwitcher,
 * Dashboard, Global App Chrome). Not wired to the real FR-00/FR-13/FR-07/
 * FR-04 backends — those don't exist yet. Real wiring happens once each
 * owning FR is built; this just proves the chrome mechanism now, same
 * pattern as FR-11's FieldRestrictionInterceptor ahead of FR-01.
 */

export interface OutletFixture {
  id: string;
  name: string;
}

export interface PropertyFixture {
  id: string;
  name: string;
  outlets: OutletFixture[];
}

export interface ChainFixture {
  id: string;
  name: string;
  properties: PropertyFixture[];
}

export const mockChain: ChainFixture = {
  id: 'chain-1',
  name: 'Al Waha Hospitality Group',
  properties: [
    {
      id: 'property-1',
      name: 'Jeddah Hotel',
      outlets: [
        { id: 'outlet-1', name: 'Main Restaurant' },
        { id: 'outlet-2', name: 'Pool Bar' },
      ],
    },
    {
      id: 'property-2',
      name: 'Riyadh Hotel',
      outlets: [{ id: 'outlet-3', name: 'Main Kitchen' }],
    },
  ],
};

// mockAlertBar lived here until FR-07 landed. The Global Alert Bar now
// reads real counts from GET /alerts/summary — which also answers for
// FR-04's PO-approval and GRN-variance badges — so the fixture is gone
// rather than left around to be picked up by mistake.

export type SearchEntityType =
  | 'Item'
  | 'Category'
  | 'Supplier'
  | 'Purchase Order'
  | 'GRN'
  | 'Transfer'
  | 'Recipe/Menu Item'
  | 'User';

export interface SearchResultFixture {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string;
}

/** Global Search index (FR-17 Global App Chrome) — scoped to
 * effectiveOutletIds in the real implementation; this fixture just
 * demonstrates grouped, type-ahead results. */
export interface CategoryFixture {
  id: string;
  name: string;
}

/** FR-01: Item Master. Not wired to the real backend yet (see this file's
 * header note) — the same "mock UI now, real API wiring is its own pass"
 * scope every other screen in web/ has used so far. */
export const mockCategories: CategoryFixture[] = [
  { id: 'cat-1', name: 'Dry Goods' },
  { id: 'cat-2', name: 'Produce' },
  { id: 'cat-3', name: 'Oils & Condiments' },
  { id: 'cat-4', name: 'Dairy' },
];

export interface ItemFixture {
  id: string;
  name: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  unit: 'KG' | 'LITRE' | 'PIECE' | 'BOX' | 'GRAM' | 'ML';
  minStock: string;
  maxStock: string;
  currentStock: string;
  costPrice: string;
  storageLocation: string | null;
  isActive: boolean;
}

export const mockItems: ItemFixture[] = [
  {
    id: 'item-1',
    name: 'Basmati Rice',
    categoryId: 'cat-1',
    sku: 'RICE-BAS-001',
    barcode: '8901030123456',
    unit: 'KG',
    minStock: '10.000',
    maxStock: '100.000',
    currentStock: '42.000',
    costPrice: '85.50',
    storageLocation: 'Dry Store A',
    isActive: true,
  },
  {
    id: 'item-2',
    name: 'All-Purpose Flour',
    categoryId: 'cat-1',
    sku: 'FLOUR-AP-001',
    barcode: null,
    unit: 'KG',
    minStock: '15.000',
    maxStock: '80.000',
    currentStock: '9.500',
    costPrice: '12.00',
    storageLocation: 'Dry Store A',
    isActive: true,
  },
  {
    id: 'item-3',
    name: 'Extra Virgin Olive Oil (5L)',
    categoryId: 'cat-3',
    sku: 'OIL-EVO-005',
    barcode: '8901030198765',
    unit: 'LITRE',
    minStock: '5.000',
    maxStock: '30.000',
    currentStock: '3.000',
    costPrice: '145.00',
    storageLocation: 'Dry Store B',
    isActive: true,
  },
  {
    id: 'item-4',
    name: 'Fresh Basil',
    categoryId: 'cat-2',
    sku: 'HERB-BAS-001',
    barcode: null,
    unit: 'BOX',
    minStock: '2.000',
    maxStock: '15.000',
    currentStock: '0.000',
    costPrice: '18.75',
    storageLocation: 'Walk-in Chiller',
    isActive: true,
  },
  {
    id: 'item-5',
    name: 'Roma Tomatoes',
    categoryId: 'cat-2',
    sku: 'VEG-TOM-001',
    barcode: '8901030155512',
    unit: 'KG',
    minStock: '10.000',
    maxStock: '60.000',
    currentStock: '38.000',
    costPrice: '9.20',
    storageLocation: 'Walk-in Chiller',
    isActive: true,
  },
  {
    id: 'item-6',
    name: 'Whole Milk',
    categoryId: 'cat-4',
    sku: 'DAIRY-MLK-001',
    barcode: '8901030177789',
    unit: 'LITRE',
    minStock: '20.000',
    maxStock: '100.000',
    currentStock: '64.000',
    costPrice: '6.50',
    storageLocation: 'Walk-in Chiller',
    isActive: true,
  },
  {
    id: 'item-7',
    name: 'Discontinued Sauce Mix',
    categoryId: 'cat-3',
    sku: 'SAUCE-DISC-001',
    barcode: null,
    unit: 'BOX',
    minStock: '2.000',
    maxStock: '10.000',
    currentStock: '0.000',
    costPrice: '22.00',
    storageLocation: null,
    isActive: false,
  },
];

export const mockSearchIndex: SearchResultFixture[] = [
  { id: 'i1', type: 'Item', title: 'All-Purpose Flour', subtitle: 'Dry Goods · 42 kg on hand' },
  { id: 'i2', type: 'Item', title: 'Olive Oil (5L)', subtitle: 'Oils · 3 bottles on hand' },
  { id: 'i3', type: 'Item', title: 'Fresh Basil', subtitle: 'Produce · 0 bunches on hand' },
  { id: 'c1', type: 'Category', title: 'Dry Goods', subtitle: '128 items' },
  { id: 'c2', type: 'Category', title: 'Produce', subtitle: '64 items' },
  { id: 's1', type: 'Supplier', title: 'Gulf Fresh Produce Co.', subtitle: 'Jeddah · 12 active POs' },
  { id: 's2', type: 'Supplier', title: 'Al-Marai Dairy', subtitle: 'Riyadh · 4 active POs' },
  { id: 'po1', type: 'Purchase Order', title: 'PO-2026-0142', subtitle: 'Gulf Fresh Produce Co. · Pending approval' },
  { id: 'g1', type: 'GRN', title: 'GRN-2026-0098', subtitle: 'Variance flagged · awaiting sign-off' },
  { id: 't1', type: 'Transfer', title: 'TRF-2026-0031', subtitle: 'Main Restaurant → Pool Bar' },
  { id: 'r1', type: 'Recipe/Menu Item', title: 'Grilled Sea Bass', subtitle: 'Main Restaurant menu' },
  { id: 'u1', type: 'User', title: 'Ahmed Al-Rashid', subtitle: 'Outlet Manager — Main Restaurant' },
];
