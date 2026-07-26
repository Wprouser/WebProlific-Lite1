import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LanguageSwitcher } from '@/components/layout/GlobalActions';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { apiClient, ApiError } from '@/lib/api-client';
import { setSession } from '@/lib/auth-store';
import { authApi } from '@/lib/auth-api';

interface LoginSuccessResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    preferredLanguage: string;
    effectiveRole: string | undefined;
    effectiveOutletIds: string[];
  };
}
interface RequiresTwoFactorResponse {
  requiresTwoFactor: true;
  pendingTwoFactorToken: string;
  method: string;
  maskedDestination: string | null;
}
interface RequiresTwoFactorEnrollmentResponse {
  requiresTwoFactorEnrollment: true;
  pendingEnrollmentToken: string;
}
type LoginResponse = LoginSuccessResponse | RequiresTwoFactorResponse | RequiresTwoFactorEnrollmentResponse;

/**
 * FR-13 Login, wired to the real `/auth/login` + `/auth/2fa/verify`
 * backend. Deliberately NOT handling `requiresTwoFactorEnrollment` (forced
 * 2FA setup) beyond a clear error — that flow needs its own enrollment UI
 * (QR code, backup codes) which doesn't exist yet. Also no refresh-token
 * rotation on the frontend yet — see auth-store.ts.
 */
export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language, changeLanguage } = useAppLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingTwoFactorToken, setPendingTwoFactorToken] = useState<string | null>(null);
  const [maskedDestination, setMaskedDestination] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function applySuccess(result: LoginSuccessResponse) {
    setSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: { ...result.user, email: '' },
    });
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

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiClient.post<LoginResponse>('/auth/login', { email, password });
      if ('requiresTwoFactorEnrollment' in result) {
        setError(t('login.enrollmentRequired'));
      } else if ('requiresTwoFactor' in result) {
        setPendingTwoFactorToken(result.pendingTwoFactorToken);
        setMaskedDestination(result.maskedDestination);
      } else {
        await applySuccess(result);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.invalidCredentials') : t('login.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingTwoFactorToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiClient.post<LoginSuccessResponse>('/auth/2fa/verify', {
        pendingTwoFactorToken,
        code,
      });
      await applySuccess(result);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.twoFactor.invalidCode') : t('login.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-4">
        <LanguageSwitcher language={language} onChange={changeLanguage} />
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-lg">
          <CardContent className="flex flex-col gap-6 pt-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue-light to-accent-blue text-base font-bold text-white shadow-sm">
                W
              </span>
              <div>
                <h1 className="font-display text-xl font-semibold text-foreground">
                  {pendingTwoFactorToken ? t('login.twoFactor.title') : t('login.title')}
                </h1>
                <p className="mt-1 text-sm text-foreground-muted">
                  {pendingTwoFactorToken
                    ? maskedDestination
                      ? t('login.twoFactor.subtitleWithDestination', { destination: maskedDestination })
                      : t('login.twoFactor.subtitle')
                    : t('login.subtitle')}
                </p>
              </div>
            </div>

            {!pendingTwoFactorToken ? (
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
                    <a href="#" className="text-sm text-accent-blue hover:underline">
                      {t('login.forgotPassword')}
                    </a>
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

                {error && <p className="text-sm text-danger">{error}</p>}

                <Button type="submit" size="lg" disabled={submitting} className="mt-2">
                  {submitting ? t('login.signingIn') : t('login.signIn')}
                </Button>
              </form>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleVerifySubmit}>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-code" className="text-sm font-medium text-foreground">
                    {t('login.twoFactor.code')}
                  </label>
                  <Input
                    id="login-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    placeholder={t('login.twoFactor.codePlaceholder')}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-danger">{error}</p>}

                <Button type="submit" size="lg" disabled={submitting} className="mt-2">
                  {submitting ? t('login.twoFactor.verifying') : t('login.twoFactor.verify')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPendingTwoFactorToken(null);
                    setCode('');
                    setError(null);
                  }}
                >
                  {t('login.twoFactor.back')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
