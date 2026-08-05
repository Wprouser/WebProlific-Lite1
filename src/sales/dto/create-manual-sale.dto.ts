import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

export class CreateManualSaleDto {
  @IsString()
  menuItemId!: string;

  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'quantitySold must be a decimal with up to 3 places' })
  quantitySold!: string;

  /** Defaults to now — a hand-entered sale is usually being logged as it
   * happens, but backdating one from a paper ticket has to be possible. */
  @IsOptional()
  @IsISO8601()
  saleTimestamp?: string;
}
