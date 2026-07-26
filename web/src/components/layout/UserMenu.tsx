import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { clearSession, getSession } from '@/lib/auth-store';
import { authApi } from '@/lib/auth-api';
import { cn } from '@/lib/cn';

export interface UserMenuProps {
  className?: string;
  avatarClassName?: string;
}

function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return (local.slice(0, 2) || '?').toUpperCase();
}

function formatRole(role: string | undefined): string {
  if (!role) return '';
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The one real (non-mock) identity display in the app — reused across the
 * `lg:`+ sidebar, the `tablet:`+ header, and the mobile drawer, since only
 * one of those three is ever visible at a given viewport width. Carries the
 * app's only Logout action; previously there was none anywhere in the UI.
 */
export function UserMenu({ className, avatarClassName }: UserMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = getSession();
  const email = session?.user.email || t('common.unknownUser');
  const role = formatRole(session?.user.effectiveRole);

  async function handleLogout() {
    const refreshToken = session?.refreshToken;
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // Best-effort server-side revocation — the user still gets logged
      // out locally even if this call fails (e.g. offline, already expired).
    }
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-w-0 items-center gap-2.5 rounded-md text-left outline-none transition-colors duration-200',
            'hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-primary',
            className,
          )}
        >
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-xs font-semibold text-accent-blue',
              avatarClassName,
            )}
          >
            {initialsFromEmail(email)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{email}</span>
            <span className="block truncate text-xs text-foreground-muted">{role}</span>
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-48 rounded-lg border border-border bg-surface p-1.5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Item
            onSelect={handleLogout}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-danger outline-none transition-colors duration-150 hover:bg-surface-secondary data-[highlighted]:bg-surface-secondary"
          >
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
