import { IsOptional, IsString, Length } from 'class-validator';

export class QueryExchangeRatesDto {
  @IsOptional()
  @IsString()
  @Length(3, 3)
  base?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  target?: string;
}
