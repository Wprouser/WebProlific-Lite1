import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateMenuItemDto {
  @IsUUID()
  outletId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
