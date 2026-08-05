import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deliberately has no `isActive` — activation is its own endpoint
 * (`PATCH /menu-items/:id/activate`) because the spec attaches a precondition
 * to it (a recipe must exist). Allowing isActive through a generic update
 * would be a way around that check.
 */
export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}
