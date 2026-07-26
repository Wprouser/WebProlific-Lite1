import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput } from './email.provider';

/**
 * Dev/local stand-in for a real email service — no SMTP/SendGrid/SES
 * credentials exist in this environment. Logs what would have been sent
 * rather than pretending to deliver it, same honesty precedent as
 * DevInvoiceOcrProvider. Swapping in a real provider means implementing
 * this same interface against that vendor's SDK; no caller changes.
 */
@Injectable()
export class DevEmailProvider implements EmailProvider {
  private readonly logger = new Logger(DevEmailProvider.name);

  async send(input: SendEmailInput): Promise<void> {
    const ccLabel = input.cc?.length ? `, cc: ${input.cc.join(', ')}` : '';
    const attachmentLabel = input.attachment ? `, attachment: ${input.attachment.filename}` : '';
    this.logger.log(`[dev email] to: ${input.to}${ccLabel} — subject: "${input.subject}"${attachmentLabel}`);
  }
}
