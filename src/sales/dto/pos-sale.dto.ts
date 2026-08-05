import { Transform } from 'class-transformer';
import { IsISO8601, IsString, Matches, MaxLength } from 'class-validator';

export class PosSaleDto {
  @IsString()
  @MaxLength(200)
  posReferenceId!: string;

  @IsString()
  menuItemId!: string;

  // POS systems commonly send quantity as a JSON number ("quantitySold": 2)
  // rather than a string, so it's normalized before validation — the rest of
  // this codebase carries decimals as strings to avoid float drift, and
  // rejecting the number form outright would fail sales for a formatting
  // difference. Format only; ">0" is checked in the service.
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'quantitySold must be a decimal with up to 3 places' })
  quantitySold!: string;

  @IsISO8601()
  timestamp!: string;
}
