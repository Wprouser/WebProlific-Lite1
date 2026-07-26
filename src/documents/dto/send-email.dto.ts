import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

/** Shared by both PO and GRN send-email endpoints — identical shape.
 * `toEmail` defaults to the supplier's email on file (spec) when omitted,
 * but is always overridable here. */
export class SendEmailDto {
  @IsOptional()
  @IsEmail()
  toEmail?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
