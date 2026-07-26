import { IsString, Length } from 'class-validator';

export class UpdateCurrencySettingsDto {
  @IsString()
  @Length(3, 3)
  baseCurrency!: string;
}
