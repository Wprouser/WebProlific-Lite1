import { ConfigService } from '@nestjs/config';
import { createEmailProvider } from './email.module';
import { DevEmailProvider } from './providers/dev-email.provider';
import { ResendEmailProvider } from './providers/resend-email.provider';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('createEmailProvider', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Jest sets NODE_ENV=test for the whole process, and the factory treats
    // that as "never send". Every case except the guard test below is about
    // the non-test selection logic, so start from a non-test environment.
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('AC: a test run never sends real email, even with a key configured', () => {
    // Regression guard. ConfigModule.forRoot() loads `.env` (which holds the
    // real key) even under jest, because test/env-setup.ts only pre-seeds the
    // keys `.env.test` actually defines — so without this the e2e suite posts
    // fixture addresses like supplier@example.com to a live provider and 422s.
    process.env.NODE_ENV = 'test';
    const provider = createEmailProvider(configWith({ RESEND_API_KEY: 're_real_key' }));
    expect(provider).toBeInstanceOf(DevEmailProvider);
  });

  it('AC: with no API key, email is logged rather than sent', () => {
    // The failure to design against: a developer who never configured email
    // silently emitting real mail.
    expect(createEmailProvider(configWith({}))).toBeInstanceOf(DevEmailProvider);
  });

  it('AC: with an API key present, it does not silently fall back to logging', () => {
    // The opposite failure: a deployment that configured email and still had
    // everything quietly go to the console.
    const provider = createEmailProvider(
      configWith({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'noreply@example.com' }),
    );
    expect(provider).toBeInstanceOf(ResendEmailProvider);
  });

  it('EMAIL_PROVIDER=dev forces the stub even when a key is configured', () => {
    const provider = createEmailProvider(
      configWith({ RESEND_API_KEY: 're_test_key', EMAIL_PROVIDER: 'dev' }),
    );
    expect(provider).toBeInstanceOf(DevEmailProvider);
  });
});
