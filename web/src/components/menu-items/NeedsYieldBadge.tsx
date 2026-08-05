import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

/**
 * FR-06's discoverable maintenance marker: this recipe is consumed as a
 * sub-recipe but has no yield, so every sale deducting through it uses the
 * pre-amendment batch-multiplier reading and is approximate.
 *
 * Warning-amber rather than danger-red on purpose — nothing is broken, and
 * stock is still being deducted. It's imprecise, and it's fixable.
 */
export function NeedsYieldBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="warning" className={className} title={t('menuItems.needsYieldHint')}>
      <AlertTriangle className="h-3 w-3" />
      {t('menuItems.needsYield')}
    </Badge>
  );
}
