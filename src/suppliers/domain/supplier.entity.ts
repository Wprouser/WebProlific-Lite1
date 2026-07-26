export interface Supplier {
  id: string;
  outletId: string;
  supplierCode: string | null;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  stateOrProvince: string | null;
  countryCode: string | null;
  postalCode: string | null;
  preferredCurrency: string | null;
  taxRegistrationType: string | null;
  taxRegistrationNumber: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfscOrSwift: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
