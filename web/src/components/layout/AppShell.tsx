import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { GlobalHeader } from './GlobalHeader';
import { AlertBar } from './AlertBar';
import { NavDrawer } from './NavDrawer';
import { NavList } from './nav-items';
import { GlobalSearchDialog } from './GlobalSearch';
import { ShortcutsHelp } from './ShortcutsHelp';
import { useKeyboardShortcut } from '@/lib/use-keyboard-shortcut';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { UserMenu } from './UserMenu';

/**
 * FR-17's dashboard/navigation shell, now also the Global App Chrome
 * container: GlobalHeader (breadcrumb/search/user), AlertBar, the
 * persistent sidebar (`lg:`+) / hamburger-drawer (below it), and the two
 * app-wide overlays (search command palette, shortcuts help) plus their
 * keyboard shortcuts.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { language, changeLanguage } = useAppLanguage();

  useKeyboardShortcut({ key: 'k', ctrlOrCmd: true, ignoreWhenTyping: false, handler: () => setSearchOpen(true) });
  useKeyboardShortcut({ key: '/', handler: () => setSearchOpen(true) });
  useKeyboardShortcut({ key: '?', handler: () => setHelpOpen(true) });

  return (
    // Flush, full-bleed layout on a clean light-gray background — the v3
    // lavender-canvas/floating-panel treatment is reverted per feedback.
    <div className="min-h-dvh bg-background">
      <GlobalHeader
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        language={language}
        onChangeLanguage={changeLanguage}
      />
      <AlertBar />

      <div className="flex">
        <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 lg:flex">
          <div className="flex items-center gap-3 px-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue-light to-accent-blue text-sm font-bold text-white shadow-sm">
              W
            </span>
            <span className="font-display text-lg font-semibold text-foreground">WebProlific</span>
          </div>

          <UserMenu
            className="w-full rounded-md bg-surface-secondary p-3"
            avatarClassName="h-10 w-10 text-sm"
          />

          <NavList />
        </aside>
        <main className="min-w-0 flex-1 p-4 tablet:p-6">
          <Outlet />
        </main>
      </div>

      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
