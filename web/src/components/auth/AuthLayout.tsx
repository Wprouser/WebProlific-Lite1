import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/Card';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  /** Rendered pre-auth, above the card — FR-13 requires the language toggle
   *  to be reachable before sign-in (and FR-15 requires it to work there). */
  languageSwitcher: ReactNode;
  children: ReactNode;
}

/**
 * Shared chrome for the pre-auth screens (login, forgot password, reset
 * password) so they stay visually identical as the flow grows — previously
 * this markup lived inline in Login.tsx, which meant a second pre-auth screen
 * had to copy it.
 */
export function AuthLayout({ title, subtitle, languageSwitcher, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-4">{languageSwitcher}</div>

      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-lg">
          <CardContent className="flex flex-col gap-6 pt-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue-light to-accent-blue text-base font-bold text-white shadow-sm">
                W
              </span>
              <div>
                <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
                <p className="mt-1 text-sm text-foreground-muted">{subtitle}</p>
              </div>
            </div>

            {children}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
