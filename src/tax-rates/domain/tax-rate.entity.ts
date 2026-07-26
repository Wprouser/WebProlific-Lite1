export interface TaxRateComponent {
  id: string;
  taxRateId: string;
  componentName: string;
  componentRate: string; // Decimal serialized as string
}

export interface TaxRate {
  id: string;
  outletId: string;
  name: string;
  ratePercent: string; // Decimal serialized as string — matches costPrice's convention
  isCompound: boolean;
  isDefault: boolean;
  isActive: boolean;
  countryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  components: TaxRateComponent[];
}
