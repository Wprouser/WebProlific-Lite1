import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LanguageSwitcher } from '@/components/layout/GlobalActions';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { ApiError } from '@/lib/api-client';
import { authApi } from '@/lib/auth-api';
import { AuthLayout } from '@/components/auth/AuthLayout';

/**
 * FR-13 forgot-password request step. The backend deliberately responds
 * identically whether or not the address exists (AuthService.forgotPassword),
 * so this screen must not distinguish either — the confirmation copy is
 * phrased conditionally ("if an account exists") to avoid re-introducing the
 * account-enumeration leak the API is careful to avoid.
 */
export function ForgotPassword() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useAppLanguage();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? t('login.tooManyAttempts')
          : t('login.genericError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={t('login.forgot.title')}
      subtitle={sent ? t('login.forgot.sentSubtitle') : t('login.forgot.subtitle')}
      languageSwitcher={<LanguageSwitcher language={language} onChange={changeLanguage} />}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p
            role="status"
            className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success"
          >
            {t('login.forgot.sent', { email })}
          </p>
          <Link to="/login">
            <Button type="button" variant="ghost" className="w-full">
              {t('login.forgot.backToLogin')}
            </Button>
          </Link>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
              {t('login.email')}
            </label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={submitting} className="mt-2">
            {submitting ? t('login.forgot.sending') : t('login.forgot.submit')}
          </Button>

          <Link to="/login">
            <Button type="button" variant="ghost" className="w-full">
              {t('login.forgot.backToLogin')}
            </Button>
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
