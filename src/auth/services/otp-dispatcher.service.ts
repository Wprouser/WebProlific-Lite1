import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorMethod } from '../constants/enums';
import { EMAIL_PROVIDER } from '../../email/providers/tokens';
import { EmailProvider } from '../../email/providers/email.provider';

export const OTP_DISPATCHER = Symbol('OTP_DISPATCHER');

/**
 * What the secret in `code` actually is. Previously implicit, which was fine
 * while every dispatch just got logged — but the three cases need genuinely
 * different emails: a 6-digit challenge code, a password-reset token that
 * belongs in a clickable link to the reset screen, and an invite token.
 * Without this, a real reset email would hand the user a bare 43-character
 * token and expect them to build a URL out of it.
 */
export type OtpPurpose = 'TWO_FACTOR' | 'PASSWORD_RESET' | 'INVITE';

export interface DispatchInput {
  destination: string;
  method: Extract<TwoFactorMethod, 'SMS' | 'EMAIL'>;
  /** The OTP, reset token, or invite token — see `purpose`. */
  code: string;
  purpose: OtpPurpose;
}

export interface OtpDispatcher {
  /** Sends a one-time secret to the user via SMS/EMAIL. Never called for TOTP. */
  dispatch(input: DispatchInput): Promise<void>;
}

/**
 * Dev-only fallback for when no email provider is configured — logs the code
 * so the login/enrollment/reset flows stay testable on a machine with no
 * credentials. AuthModule binds this only when EMAIL_PROVIDER resolved to the
 * dev stub; otherwise EmailOtpDispatcher takes over.
 */
@Injectable()
export class ConsoleOtpDispatcherService implements OtpDispatcher {
  private readonly logger = new Logger(ConsoleOtpDispatcherService.name);

  async dispatch({ destination, method, code, purpose }: DispatchInput): Promise<void> {
    this.logger.log(`[DEV OTP] ${method} to ${destination} (${purpose}): ${code}`);
  }
}

/**
 * Real dispatcher: renders a purpose-appropriate message and hands it to the
 * shared EmailProvider boundary, so OTP mail, password-reset mail and the
 * PO/GRN documents all leave through one configured vendor rather than two
 * parallel senders.
 *
 * SMS still has no provider in this project, so an SMS-method dispatch is
 * logged and explicitly flagged as undelivered rather than silently dropped —
 * the honest failure, since returning success would leave a user waiting on a
 * text that is never coming.
 */
@Injectable()
export class EmailOtpDispatcher implements OtpDispatcher {
  private readonly logger = new Logger(EmailOtpDispatcher.name);
  private readonly appBaseUrl: string;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    config: ConfigService,
  ) {
    this.appBaseUrl = (config.get<string>('APP_BASE_URL') ?? 'http://localhost:5173').replace(
      /\/+$/,
      '',
    );
  }

  async dispatch({ destination, method, code, purpose }: DispatchInput): Promise<void> {
    if (method === 'SMS') {
      this.logger.warn(
        `SMS not configured — code for ${destination} (${purpose}) was NOT delivered: ${code}`,
      );
      return;
    }

    const { subject, body } = this.render(code, purpose);
    await this.emailProvider.send({ to: destination, subject, body });
  }

  private render(code: string, purpose: OtpPurpose): { subject: string; body: string } {
    switch (purpose) {
      case 'PASSWORD_RESET': {
        const link = `${this.appBaseUrl}/reset-password?token=${encodeURIComponent(code)}`;
        return {
          subject: 'Reset your WebProlific password',
          body: paragraphs(
            'We received a request to reset your WebProlific password.',
            `<a href="${link}">Choose a new password</a>`,
            `If the link doesn't work, paste this into your browser:<br><code>${link}</code>`,
            "This link expires shortly. If you didn't request it, you can ignore this email.",
          ),
        };
      }
      case 'INVITE':
        // No accept-invite screen exists in the web app yet (FR-14's UI is
        // still backend-only), so this gives the raw token rather than linking
        // to a route that would 404.
        return {
          subject: "You've been invited to WebProlific",
          body: paragraphs(
            'You have been invited to WebProlific. Use this invite token to set your password:',
            `<code>${code}</code>`,
            'This token expires shortly.',
          ),
        };
      case 'TWO_FACTOR':
      default:
        return {
          subject: `${code} is your WebProlific verification code`,
          body: paragraphs(
            'Your verification code is:',
            `<strong style="font-size:24px;letter-spacing:3px">${code}</strong>`,
            "This code expires shortly. If you didn't try to sign in, change your password.",
          ),
        };
    }
  }
}

function paragraphs(...lines: string[]): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">${lines
    .map((line) => `<p>${line}</p>`)
    .join('')}</div>`;
}
