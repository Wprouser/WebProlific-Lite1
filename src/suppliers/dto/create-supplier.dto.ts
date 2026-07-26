import { IsEmail, IsInt, IsOptional, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class CreateSupplierDto {
  // Not in the spec's illustrative request body, but Supplier.outletId is a
  // required schema field with no route param to source it from (FR-03's
  // endpoints are flat) — same body.outletId precedent as CreateItemDto.
  @IsString()
  outletId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  supplierCode?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  stateOrProvince?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  // Loose reference to Currency.code — not validated against the registry
  // at the DTO level (the service does that, same as Outlet.baseCurrency).
  @IsOptional()
  @IsString()
  preferredCurrency?: string;

  // Free text/lookup label (e.g. "GSTIN", "VAT Reg. No.", "TRN", "NONE"),
  // deliberately not @IsIn(...) — registration naming varies by country.
  @IsOptional()
  @IsString()
  taxRegistrationType?: string;

  // Spec: "validated only for non-empty format if provided, not checksum-
  // validated against any specific country's rules" — @IsString() +
  // @IsOptional() already gives exactly that (non-empty-if-present).
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankIfscOrSwift?: string;
}
