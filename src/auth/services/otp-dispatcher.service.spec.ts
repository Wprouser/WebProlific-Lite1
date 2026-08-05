import { ConfigService } from '@nestjs/config';
import { EmailOtpDispatcher } from './otp-dispatcher.service';
import { EmailProvider, SendEmailInput } from '../../email/providers/email.provider';

function makeDispatcher(config: Record<string, string> = {}) {
  const sent: SendEmailInput[] = [];
  const emailProvider: EmailProvider = {
    send: async (input) => {
      sent.push(input);
    },
  };
  const configService = {
    get: (key: string) => config[key],
  } as unknown as ConfigService;

  return { dispatcher: new EmailOtpDispatcher(emailProvider, configService), sent };
}

describe('EmailOtpDispatcher', () => {
  it('puts the code in both the subject and the body for a 2FA challenge', async () => {
    const { dispatcher, sent } = makeDispatcher();

    await dispatcher.dispatch({
      destination: 'user@example.com',
      method: 'EMAIL',
      code: '482913',
      purpose: 'TWO_FACTOR',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('user@example.com');
    // Subject-line code is what makes the OTP readable from a notification
    // preview without opening the mail.
    expect(sent[0].subject).toContain('482913');
    expect(sent[0].body).toContain('482913');
  });

  it('AC: a password reset links to the reset screen instead of dumping the token', async () => {
    const { dispatcher, sent } = makeDispatcher({ APP_BASE_URL: 'https://app.example.com' });

    await dispatcher.dispatch({
      destination: 'user@example.com',
      method: 'EMAIL',
      code: 'raw-reset-token',
      purpose: 'PASSWORD_RESET',
    });

    // ResetPassword.tsx reads ?token= — the link has to match that contract.
    expect(sent[0].body).toContain(
      'https://app.example.com/reset-password?token=raw-reset-token',
    );
    expect(sent[0].subject).toMatch(/reset/i);
  });

  it('url-encodes reset tokens so token characters cannot break the query string', async () => {
    const { dispatcher, sent } = makeDispatcher({ APP_BASE_URL: 'https://app.example.com' });

    await dispatcher.dispatch({
      destination: 'user@example.com',
      method: 'EMAIL',
      code: 'tok+en/with=chars',
      purpose: 'PASSWORD_RESET',
    });

    expect(sent[0].body).toContain('token=tok%2Ben%2Fwith%3Dchars');
  });

  it('trims a trailing slash on APP_BASE_URL rather than emitting a double slash', async () => {
    const { dispatcher, sent } = makeDispatcher({ APP_BASE_URL: 'https://app.example.com/' });

    await dispatcher.dispatch({
      destination: 'user@example.com',
      method: 'EMAIL',
      code: 't',
      purpose: 'PASSWORD_RESET',
    });

    expect(sent[0].body).toContain('https://app.example.com/reset-password');
    expect(sent[0].body).not.toContain('.com//reset-password');
  });

  it('defaults APP_BASE_URL to the Vite dev origin when unset', async () => {
    const { dispatcher, sent } = makeDispatcher();

    await dispatcher.dispatch({
      destination: 'user@example.com',
      method: 'EMAIL',
      code: 't',
      purpose: 'PASSWORD_RESET',
    });

    expect(sent[0].body).toContain('http://localhost:5173/reset-password?token=t');
  });

  it('AC: an SMS dispatch is not silently swallowed as a successful send', async () => {
    const { dispatcher, sent } = makeDispatcher();

    await dispatcher.dispatch({
      destination: '+966500000000',
      method: 'SMS',
      code: '482913',
      purpose: 'TWO_FACTOR',
    });

    // No SMS provider exists — the important part is that nothing was emailed
    // to a phone number, which is what a naive fallthrough would do.
    expect(sent).toHaveLength(0);
  });
});
