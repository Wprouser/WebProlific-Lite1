import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LanguageSwitcher } from '@/components/layout/GlobalActions';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { ApiError } from '@/lib/api-client';
import { authApi } from '@/lib/auth-api';
import { AuthLayout } from '@/components/auth/AuthLayout';

/** Mirrors ResetPasswordDto's @MinLength(8) so the user sees the rule before
 *  a round-trip rejects them for it. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * FR-13 reset step. The token arrives as `?token=` (the value the backend
 * dispatched to the user); it is never displayed, only submitted.
 */
export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language, changeLanguage } = useAppLanguage();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('login.reset.tooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('login.reset.mismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      // 400 is the backend's "invalid or expired reset token" — worth saying
      // plainly, since the fix (request a new link) differs from a retry.
      setError(
        err instanceof ApiError && err.status === 400
          ? t('login.reset.invalidToken')
          : t('login.genericError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const switcher = <LanguageSwitcher language={language} onChange={changeLanguage} />;

  if (!token) {
    return (
      <AuthLayout
        title={t('login.reset.title')}
        subtitle={t('login.reset.subtitle')}
        languageSwitcher={switcher}
      >
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          {t('login.reset.missingToken')}
        </p>
        <Link to="/forgot-password">
          <Button type="button" variant="ghost" className="w-full">
            {t('login.reset.requestNew')}
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title={t('login.reset.title')}
        subtitle={t('login.reset.doneSubtitle')}
        languageSwitcher={switcher}
      >
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success"
        >
          {t('login.reset.done')}
        </p>
        <Button type="button" size="lg" onClick={() => navigate('/login', { replace: true })}>
          {t('login.reset.goToLogin')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('login.reset.title')}
      subtitle={t('login.reset.subtitle')}
      languageSwitcher={switcher}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reset-password" className="text-sm font-medium text-foreground">
            {t('login.reset.newPassword')}
          </label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-foreground-muted">
            {t('login.reset.rule', { min: MIN_PASSWORD_LENGTH })}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reset-confirm" className="text-sm font-medium text-foreground">
            {t('login.reset.confirmPassword')}
          </label>
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={submitting} className="mt-2">
          {submitting ? t('login.reset.submitting') : t('login.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
