import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Radix Dialog underneath for correct focus-trap/portal/escape-key
 * behavior — the one core component where hand-rolling would be easy to
 * get subtly wrong (see FR-17 implementation plan). Everything else in
 * this library is plain Tailwind + our own tokens.
 */
export function Modal({ open, onOpenChange, title, description, children, className }: ModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            // max-h/overflow — without this, a modal taller than the
            // viewport (e.g. a long form on a short laptop screen) renders
            // past both the top and bottom of the visible area with no way
            // to scroll to the rest, including its own footer buttons.
            'max-h-[90vh] overflow-y-auto',
            'rounded-lg border border-border bg-surface p-7 shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1.5 text-sm text-foreground-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {children && <div className="mt-5">{children}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
