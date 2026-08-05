import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from './providers/tokens';
import { DevEmailProvider } from './providers/dev-email.provider';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { EmailProvider } from './providers/email.provider';

/**
 * Picks the email provider from configuration at boot.
 *
 * The selection is presence-driven rather than flag-driven: if RESEND_API_KEY
 * is set, mail really goes out; if not, DevEmailProvider logs it. That way a
 * developer who has never configured email can't accidentally send, and a
 * deployment that *has* configured it can't silently fall back to logging —
 * the two failure modes worth designing against. EMAIL_PROVIDER=dev forces
 * the stub even with a key present, for exercising the flow without spending
 * real sends. Either way it says which one it chose at startup, so "did that
 * actually send?" is answerable from the logs.
 */
export function createEmailProvider(config: ConfigService): EmailProvider {
  const logger = new Logger('EmailModule');
  const forced = config.get<string>('EMAIL_PROVIDER');
  const apiKey = config.get<string>('RESEND_API_KEY');

  // Hard guard: a test run must never send real email, whatever the config
  // says. This is not paranoia — ConfigModule.forRoot() with no envFilePath
  // loads `.env`, and test/env-setup.ts only pre-seeds the keys `.env.test`
  // actually defines. Anything set in `.env` but absent from `.env.test`
  // (RESEND_API_KEY being exactly that) therefore leaks into the e2e run, and
  // the suite starts posting fixture addresses to a live provider. Relying on
  // every developer's gitignored `.env.test` to opt out is not a guarantee.
  if (config.get<string>('NODE_ENV') === 'test' || process.env.NODE_ENV === 'test') {
    logger.warn('NODE_ENV=test — email is logged, never sent.');
    return new DevEmailProvider();
  }

  if (forced === 'dev') {
    logger.warn('EMAIL_PROVIDER=dev — email will be logged, not sent.');
    return new DevEmailProvider();
  }
  if (apiKey) {
    const from = config.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';
    logger.log(`Email enabled via Resend (from: ${from}).`);
    return new ResendEmailProvider(config);
  }

  logger.warn('RESEND_API_KEY is not set — email will be logged, not sent.');
  return new DevEmailProvider();
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: createEmailProvider,
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
