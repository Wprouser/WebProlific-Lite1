import { Matches } from 'class-validator';

export class PreviewTaxRateDto {
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'subtotal must be a decimal with up to 2 places' })
  subtotal!: string;
}
