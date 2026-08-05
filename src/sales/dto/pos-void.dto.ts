import { IsString, MaxLength } from 'class-validator';

export class PosVoidDto {
  /** The POS's own reference for the sale being voided — the POS has no
   * knowledge of our Sale ids. */
  @IsString()
  @MaxLength(200)
  posReferenceId!: string;
}
