import { IsString, Length, Matches } from 'class-validator';

export class CreateExchangeRateDto {
  @IsString()
  @Length(3, 3)
  baseCurrency!: string;

  @IsString()
  @Length(3, 3)
  targetCurrency!: string;

  // Decimal(12,6) — up to 6 decimal places, matching the schema.
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'rate must be a decimal with up to 6 places' })
  rate!: string;
}
