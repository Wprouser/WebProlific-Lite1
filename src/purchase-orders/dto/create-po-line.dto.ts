import { IsOptional, IsString, Matches } from 'class-validator';

export class CreatePOLineDto {
  @IsString()
  itemId!: string;

  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'orderedQty must be a decimal with up to 3 places' })
  orderedQty!: string;

  // Unit price as entered — meaning depends on the document's
  // isTaxInclusive toggle (see apply-document-tax.ts).
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'expectedPrice must be a decimal with up to 2 places' })
  expectedPrice!: string;

  // Omitted/null means untaxed — a deliberate, valid, first-class state
  // (spec: "no taxRateId means no tax, full stop"), never rejected.
  @IsOptional()
  @IsString()
  taxRateId?: string;
}
