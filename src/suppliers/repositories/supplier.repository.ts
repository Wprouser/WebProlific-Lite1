import { Supplier } from '../domain/supplier.entity';

export interface CreateSupplierInput {
  outletId: string;
  supplierCode?: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  stateOrProvince?: string;
  countryCode?: string;
  postalCode?: string;
  preferredCurrency?: string;
  taxRegistrationType?: string;
  taxRegistrationNumber?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfscOrSwift?: string;
}

export interface UpdateSupplierInput {
  supplierCode?: string | null;
  name?: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  preferredCurrency?: string | null;
  taxRegistrationType?: string | null;
  taxRegistrationNumber?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfscOrSwift?: string | null;
  isActive?: boolean;
}

export interface SupplierFilters {
  /** Every result row must have an outletId in this set — scoping, not an
   * explicit user-chosen filter. */
  accessibleOutletIds: string[];
  outletId?: string;
  isActive?: boolean;
  /** Case-insensitive substring match against name or supplierCode. */
  search?: string;
}

export interface SupplierRepository {
  create(data: CreateSupplierInput): Promise<Supplier>;
  findById(id: string): Promise<Supplier | null>;
  update(id: string, data: UpdateSupplierInput): Promise<Supplier>;
  findScoped(filters: SupplierFilters): Promise<Supplier[]>;
}
