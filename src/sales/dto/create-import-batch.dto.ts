import { IsIn, IsOptional, IsString } from 'class-validator';
import { DEFAULT_SALES_DATE_FORMAT, SALES_DATE_FORMATS, SalesDateFormat } from '../constants/enums';

/** Multipart companion to the uploaded file — the outlet whose sales these
 * are, which a sales export file never carries itself, and how to read its
 * dates, which it doesn't carry either. */
export class CreateImportBatchDto {
  @IsString()
  outletId!: string;

  /** Defaults day-first rather than being inferred from the data — see
   * SALES_DATE_FORMATS for why inference is the dangerous option. */
  @IsOptional()
  @IsIn(SALES_DATE_FORMATS)
  dateFormat?: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT;
}
