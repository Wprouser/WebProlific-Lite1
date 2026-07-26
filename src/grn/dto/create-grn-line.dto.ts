import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateGrnLineDto {
  @IsString()
  itemId!: string;

  // Present for a PO-linked line (echoed back so the service can validate
  // against the PO's own orderedQty/alreadyReceivedQty and know which
  // POLine to increment); absent for a Direct GRN line, where there's
  // nothing ordered to compare against.
  @IsOptional()
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'orderedQty must be a decimal with up to 3 places' })
  orderedQty?: string;

  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'receivedQty must be a decimal with up to 3 places' })
  receivedQty!: string;

  // Unit price as entered — meaning depends on the document's
  // isTaxInclusive toggle (see apply-document-tax.ts).
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'actualPrice must be a decimal with up to 2 places' })
  actualPrice!: string;

  // Omitted/null means untaxed — a deliberate, valid, first-class state
  // (spec: "no taxRateId means no tax, full stop"), never rejected.
  @IsOptional()
  @IsString()
  taxRateId?: string;
}
