import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { OUTLET_TYPES, OutletType } from '../constants/enums';

export class UpdateOutletDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(OUTLET_TYPES)
  type?: OutletType;

  // baseCurrency is deliberately NOT here — it must go through the
  // dedicated PATCH /outlets/:id/currency-settings endpoint (CHAIN_OWNER
  // only, blocked once transactional history exists per FR-16's business
  // rule). This generic settings endpoint is open to CHAIN_OWNER/
  // PROPERTY_MANAGER/OUTLET_MANAGER, which would otherwise be a back door
  // around that restriction.

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'poApprovalThreshold must be a decimal with up to 2 places',
  })
  poApprovalThreshold?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
