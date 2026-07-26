import { IsString, Matches, MinLength } from 'class-validator';

export class TaxRateComponentDto {
  @IsString()
  @MinLength(1)
  componentName!: string;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'componentRate must be a decimal with up to 2 places' })
  componentRate!: string;
}
