import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ContextSwitcher } from './ContextSwitcher';
import { Clock } from './Clock';
import { GlobalSearchTrigger } from './GlobalSearch';
import { GlobalActionsMenu, GlobalActionsRow, type Language } from './GlobalActions';
import { UserMenu } from './UserMenu';

export interface GlobalHeaderProps {
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

/**
 * FR-17 Global App Chrome, Global Header: breadcrumb switcher + date/time +
 * user/role, present on every screen. Split into two rows rather than one
 * dense line — with the breadcrumb, search, alert bar, and six actions all
 * mandatory on every screen, cramming everything into one row left the
 * breadcrumb (the primary orientation element the spec calls out as most
 * important) squeezed down to a few characters even at 1280px. Row 1 is
 * the primary nav row (always present); row 2 is a lower-weight utility
 * strip (clock + the six actions) that only exists at `lg:`+ — below that,
 * a single compact overflow-menu button in row 1 covers the same actions.
 */
export function GlobalHeader({
  onOpenDrawer,
  onOpenSearch,
  onOpenHelp,
  language,
  onChangeLanguage,
}: GlobalHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="flex h-14 items-center gap-2 px-5 tablet:gap-3 tablet:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          aria-label={t('common.openMenu')}
          onClick={onOpenDrawer}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1">
          <ContextSwitcher />
        </div>

        <GlobalSearchTrigger onClick={onOpenSearch} />

        <div className="hidden shrink-0 tablet:block">
          <UserMenu className="max-w-64 p-1.5" />
        </div>

        <div className="shrink-0 lg:hidden">
          <GlobalActionsMenu onOpenHelp={onOpenHelp} language={language} onChangeLanguage={onChangeLanguage} />
        </div>

        <div className="shrink-0">
          <ThemeToggle />
        </div>
      </div>

      <div className="hidden items-center justify-between gap-3 border-t border-border px-4 py-1 lg:flex tablet:px-6">
        <span className="text-sm text-foreground-muted">
          <Clock />
        </span>
        <GlobalActionsRow onOpenHelp={onOpenHelp} language={language} onChangeLanguage={onChangeLanguage} />
      </div>
    </header>
  );
}
