import { IsIn, IsOptional, IsString } from 'class-validator';
import { ALERT_STATUSES, ALERT_TYPES, AlertStatus, AlertType } from '../constants/enums';

export class QueryAlertsDto {
  @IsOptional()
  @IsString()
  outletId?: string;

  @IsOptional()
  @IsIn(ALERT_STATUSES)
  status?: AlertStatus;

  @IsOptional()
  @IsIn(ALERT_TYPES)
  type?: AlertType;
}
