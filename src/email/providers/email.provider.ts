export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  attachment?: EmailAttachment;
}

/**
 * Swappable email boundary (spec: "Email sending goes through the same
 * notification infrastructure described in FR-07 (Alerts) — a swappable
 * provider interface, not hardcoded to one email service") — mirrors this
 * project's Repository Pattern / StorageRepository / InvoiceOcrProvider
 * precedent so a real provider (SendGrid, SES, SMTP) can replace
 * DevEmailProvider without touching any calling service.
 */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}
