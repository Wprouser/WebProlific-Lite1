import { IsString, Matches } from 'class-validator';

export class CloneItemDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'sku must be alphanumeric with hyphens only' })
  sku!: string;
}
