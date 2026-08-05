import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailInput } from './email.provider';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Real email delivery via Resend's HTTP API.
 *
 * Deliberately plain `fetch` rather than the `resend` SDK: the request is a
 * single JSON POST, Node's global fetch covers it, and this keeps the
 * dependency surface (and its transitive tree) out of the backend for what
 * amounts to twenty lines. The EmailProvider boundary is what makes the
 * vendor swappable — not the SDK.
 *
 * Configured by RESEND_API_KEY + EMAIL_FROM. EmailModule only binds this when
 * a key is present, so a developer without one keeps DevEmailProvider and
 * nothing silently no-ops.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    // Non-null asserted via EmailModule's factory, which only constructs this
    // when RESEND_API_KEY is set.
    this.apiKey = config.get<string>('RESEND_API_KEY')!;
    this.from = config.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';
  }

  async send(input: SendEmailInput): Promise<void> {
    const payload: Record<string, unknown> = {
      from: this.from,
      to: [input.to],
      subject: input.subject,
      // `body` is already HTML at every call site that cares (see
      // OtpEmailTemplates); Resend requires html or text, not neither.
      html: input.body,
    };
    if (input.cc?.length) payload.cc = input.cc;
    if (input.attachment) {
      payload.attachments = [
        {
          filename: input.attachment.filename,
          content: input.attachment.content.toString('base64'),
        },
      ];
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Body first — Resend puts the actionable reason there ("You can only
      // send testing emails to your own address" is the one you hit before
      // verifying a domain).
      const detail = await response.text().catch(() => '');
      this.logger.error(`Resend rejected the send to ${input.to}: ${response.status} ${detail}`);
      throw new Error(`Email delivery failed (${response.status}): ${detail}`);
    }

    this.logger.log(`Sent "${input.subject}" to ${input.to} via Resend`);
  }
}
