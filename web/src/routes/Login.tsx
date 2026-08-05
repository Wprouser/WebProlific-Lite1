import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LanguageSwitcher } from '@/components/layout/GlobalActions';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { ApiError } from '@/lib/api-client';
import {
  authApi,
  isEnrollmentRequired,
  isTwoFactorRequired,
  type LoginSuccessResponse,
  type RequiresTwoFactorResponse,
} from '@/lib/auth-api';
import {
  consumeSessionExpired,
  getTrustedDeviceToken,
  setSession,
  setTrustedDeviceToken,
} from '@/lib/auth-store';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { deviceLabel } from '@/lib/device-label';

/** Seconds the "Resend code" button stays disabled after a send. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * FR-13 Login: credentials step, then the 2FA challenge step (code entry,
 * resend with cooldown, backup-code fallback, trust-this-device), wired to
 * the real /auth endpoints.
 *
 * Forced 2FA enrollment (`requiresTwoFactorEnrollment`) is still surfaced as
 * an explanatory message rather than an enrollment flow — that needs the
 * TOTP QR + backup-code UI, which the spec places on a Settings screen that
 * doesn't exist yet. Flagged rather than silently swallowed: without a
 * message the user would just see a login that appears to do nothing.
 */
export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language, changeLanguage } = useAppLanguage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [challenge, setChallenge] = useState<RequiresTwoFactorResponse | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Set by api-client when a refresh attempt failed — tells the user why they
  // were bounced here instead of leaving them to guess.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    // Only ever set true: the flag is one-shot, and StrictMode invokes this
    // effect twice in dev — the second call would otherwise read `false`
    // (the first already consumed it) and immediately hide the banner.
    if (consumeSessionExpired()) setExpired(true);
  }, []);

  const codeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (challenge) codeInputRef.current?.focus();
  }, [challenge, useBackupCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function applySuccess(result: LoginSuccessResponse) {
    // Persisted before the profile fetch below, because that fetch is itself
    // an authenticated call and reads the token back out of the store.
    setSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: { ...result.user, email: '' },
    });

    if (result.trustedDeviceToken) setTrustedDeviceToken(result.trustedDeviceToken);

    try {
      // The login response itself carries no email (see auth-store.ts) —
      // fetch it once so the header/sidebar user menu can show who's
      // actually signed in instead of a placeholder.
      const profile = await authApi.me();
      setSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: { ...result.user, email: profile.email },
      });
    } catch {
      // Non-fatal — the user menu just shows a blank email if this fails.
    }
    navigate('/', { replace: true });
  }

  function describeError(err: unknown, invalidMessage: string): string {
    if (err instanceof ApiError) {
      if (err.status === 401) return invalidMessage;
      // Throttler (see PerUserThrottlerGuard on the auth routes).
      if (err.status === 429) return t('login.tooManyAttempts');
      if (err.status === 400) return err.message;
    }
    return t('login.genericError');
  }

  function resetToCredentials() {
    setChallenge(null);
    setUseBackupCode(false);
    setCode('');
    setTrustDevice(false);
    setCooldown(0);
    setError(null);
    setNotice(null);
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setExpired(false);
    setSubmitting(true);
    try {
      const stored = getTrustedDeviceToken();
      const result = await authApi.login({
        email,
        password,
        // Presenting a valid one lets the backend skip the 2FA challenge
        // entirely (AuthService.completeLoginFlow step 2).
        ...(stored ? { trustedDeviceToken: stored } : {}),
      });

      if (isEnrollmentRequired(result)) {
        setError(t('login.enrollmentRequired'));
      } else if (isTwoFactorRequired(result)) {
        setChallenge(result);
        // SMS/EMAIL codes are dispatched by the login call itself, so the
        // cooldown starts now, not on first Resend click.
        if (result.method !== 'TOTP') setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        await applySuccess(result);
      }
    } catch (err) {
      setError(describeError(err, t('login.invalidCredentials')));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const shared = {
        pendingTwoFactorToken: challenge.pendingTwoFactorToken,
        trustDevice,
        ...(trustDevice ? { deviceLabel: deviceLabel() } : {}),
      };
      const result = useBackupCode
        ? await authApi.loginWithBackupCode({ ...shared, backupCode: code.trim() })
        : await authApi.verifyTwoFactor({ ...shared, code: code.trim() });
      await applySuccess(result);
    } catch (err) {
      setError(
        describeError(
          err,
          useBackupCode ? t('login.twoFactor.invalidBackupCode') : t('login.twoFactor.invalidCode'),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!challenge || cooldown > 0) return;
    setError(null);
    setNotice(null);
    try {
      await authApi.resendTwoFactor(challenge.pendingTwoFactorToken);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice(t('login.twoFactor.resent'));
    } catch (err) {
      setError(describeError(err, t('login.genericError')));
    }
  }

  const title = challenge ? t('login.twoFactor.title') : t('login.title');
  const subtitle = challenge
    ? challenge.maskedDestination
      ? t('login.twoFactor.subtitleWithDestination', { destination: challenge.maskedDestination })
      : t('login.twoFactor.subtitle')
    : t('login.subtitle');

  return (
    <AuthLayout
      title={title}
      subtitle={subtitle}
      languageSwitcher={<LanguageSwitcher language={language} onChange={changeLanguage} />}
    >
      {expired && (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          {t('login.sessionExpired')}
        </p>
      )}

      {!challenge ? (
        <form className="flex flex-col gap-4" onSubmit={handleLoginSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-sm font-medium text-foreground">
              {t('login.email')}
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="text-sm font-medium text-foreground">
                {t('login.password')}
              </label>
              <Link to="/forgot-password" className="text-sm text-accent-blue hover:underline">
                {t('login.forgotPassword')}
              </Link>
            </div>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={submitting} className="mt-2">
            {submitting ? t('login.signingIn') : t('login.signIn')}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleVerifySubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-code" className="text-sm font-medium text-foreground">
              {useBackupCode ? t('login.twoFactor.backupCode') : t('login.twoFactor.code')}
            </label>
            <Input
              id="login-code"
              ref={codeInputRef}
              // Backup codes are alphanumeric; only the OTP path is numeric.
              inputMode={useBackupCode ? 'text' : 'numeric'}
              autoComplete={useBackupCode ? 'off' : 'one-time-code'}
              required
              placeholder={
                useBackupCode
                  ? t('login.twoFactor.backupCodePlaceholder')
                  : t('login.twoFactor.codePlaceholder')
              }
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-md border border-border-strong p-2.5">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm text-foreground-muted">
              <span className="block font-medium text-foreground">
                {t('login.twoFactor.trustDevice')}
              </span>
              {t('login.twoFactor.trustDeviceHint')}
            </span>
          </label>

          {notice && (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={submitting} className="mt-2">
            {submitting ? t('login.twoFactor.verifying') : t('login.twoFactor.verify')}
          </Button>

          {/* Resend only applies to codes the server dispatched — the backend
              rejects it outright for TOTP (AuthService.resendTwoFactor). */}
          {challenge.method !== 'TOTP' && !useBackupCode && (
            <Button type="button" variant="ghost" onClick={handleResend} disabled={cooldown > 0}>
              {cooldown > 0
                ? t('login.twoFactor.resendIn', { seconds: cooldown })
                : t('login.twoFactor.resend')}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setUseBackupCode((v) => !v);
              setCode('');
              setError(null);
              setNotice(null);
            }}
          >
            {useBackupCode ? t('login.twoFactor.useCode') : t('login.twoFactor.useBackupCode')}
          </Button>

          <Button type="button" variant="ghost" onClick={resetToCredentials}>
            {t('login.twoFactor.back')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
