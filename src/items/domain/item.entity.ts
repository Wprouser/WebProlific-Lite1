export interface Item {
  id: string;
  outletId: string;
  name: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  unit: string;
  minStock: string; // Decimal serialized as string at the repository boundary
  maxStock: string;
  currentStock: string;
  shelfLifeDays: number | null;
  costPrice: string;
  defaultSupplierId: string | null;
  purchaseGLAccount: string | null;
  defaultTaxRateId: string | null;
  storageLocation: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
