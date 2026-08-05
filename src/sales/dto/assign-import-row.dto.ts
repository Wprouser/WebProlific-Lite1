import { IsString } from 'class-validator';

/** Review screen: correct one unmatched (or wrongly matched) row's menu
 * item, without re-uploading the file. */
export class AssignImportRowDto {
  @IsString()
  menuItemId!: string;
}
