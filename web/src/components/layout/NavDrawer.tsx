import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavList } from './nav-items';
import { UserMenu } from './UserMenu';
import { cn } from '@/lib/cn';

export interface NavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** FR-17: "The context switcher and any navigation chrome must have an
 * explicit mobile pattern (e.g., collapsing into a drawer/sheet) below
 * `md`." AppShell shows a persistent sidebar at `lg:`+ and this
 * hamburger-triggered drawer below it. Also carries the user identity
 * block, since GlobalHeader hides that below `tablet:` to make room for
 * the breadcrumb — a common, expected place for it in a mobile drawer. */
export function NavDrawer({ open, onOpenChange }: NavDrawerProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] lg:hidden" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-1 bg-surface p-5 shadow-xl lg:hidden',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
          )}
        >
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg font-semibold text-foreground">
              WebProlific
            </Dialog.Title>
            <Dialog.Close
              className="flex h-12 w-12 items-center justify-center rounded-md text-foreground-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('common.closeMenu')}
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <UserMenu
            className="mb-4 w-full rounded-md bg-surface-secondary p-3 tablet:hidden"
            avatarClassName="h-10 w-10 text-sm"
          />

          <NavList onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
