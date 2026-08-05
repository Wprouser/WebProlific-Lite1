import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  Coins,
  FileText,
  LayoutDashboard,
  Package,
  Palette,
  Percent,
  Receipt,
  Truck,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface NavItem {
  /** Stable key + fallback text; display text comes from `nav.<labelKey>`. */
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /** Undefined = not built yet (FR-01 etc.) — rendered disabled rather than
   * linking somewhere broken. */
  to?: string;
}

export const navItems: NavItem[] = [
  { labelKey: 'dashboard', icon: LayoutDashboard, to: '/' },
  { labelKey: 'items', icon: Package, to: '/items' },
  { labelKey: 'stock', icon: ClipboardList, to: '/stock' },
  // FR-04's Tax Configuration: outlet-level shared reference data used by
  // Items, POs, and GRNs alike — a top-level nav destination, not an Items
  // sub-feature. Visible to every role (not just CHAIN_OWNER/PROPERTY_
  // MANAGER, who can mutate it) since OUTLET_MANAGER-tier users still
  // benefit from seeing/previewing the rates in use, matching the
  // Preview-vs-Edit/Deactivate split already enforced on the screen itself.
  { labelKey: 'taxes', icon: Percent, to: '/tax-rates' },
  // FR-16's Currency & Exchange Rates: Currency/ExchangeRate are global,
  // platform-wide reference data (not outlet-scoped, unlike TaxRate) — a
  // top-level destination for the same reason Taxes is. Visible to every
  // role; the screen itself gates the two mutating actions separately
  // (base-currency change: CHAIN_OWNER only; add rate: CHAIN_OWNER/
  // PROPERTY_MANAGER), same read-vs-mutate split as Tax Configuration.
  { labelKey: 'currency', icon: Coins, to: '/currency' },
  // FR-03's Supplier Management — now built.
  { labelKey: 'suppliers', icon: Truck, to: '/suppliers' },
  // FR-04's Purchase Orders and GRN — both now built.
  { labelKey: 'purchaseOrders', icon: FileText, to: '/purchase-orders' },
  { labelKey: 'grn', icon: ClipboardList, to: '/grn' },
  // FR-05's Menu Items / recipes. Built alongside FR-06 because its Unmapped
  // Items worklist has to link somewhere, and the "Needs yield" badge has to
  // live somewhere.
  { labelKey: 'menuItems', icon: ChefHat, to: '/menu-items' },
  // FR-06's Sales: history, the Unmapped Items worklist, and the daily
  // batch-import flow. Top-level, same tier as Items/Stock/Suppliers — the
  // webhook path has no UI of its own, but everything else here does.
  { labelKey: 'sales', icon: Receipt, to: '/sales' },
  { labelKey: 'reports', icon: BarChart3 },
  { labelKey: 'users', icon: Users },
  { labelKey: 'styleguide', icon: Palette, to: '/styleguide' },
];

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-0.5">
      {navItems.map((item) => {
        const Icon = item.icon;
        const label = t(`nav.${item.labelKey}`);
        if (!item.to) {
          return (
            <div
              key={item.labelKey}
              className="flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm text-foreground-muted opacity-50"
              aria-disabled
            >
              <Icon className="h-4 w-4" />
              {label}
              <span className="ml-auto rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {t('nav.soon')}
              </span>
            </div>
          );
        }
        return (
          <NavLink
            key={item.labelKey}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-foreground-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-foreground',
                isActive && 'bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/10 hover:text-accent-blue',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}
