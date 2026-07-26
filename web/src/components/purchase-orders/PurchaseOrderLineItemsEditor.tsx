import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import type { ApiItem } from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';
import type { POLineInput } from '@/lib/purchase-orders-api';
import { previewLineTax } from '@/lib/document-tax-preview';
import { cn } from '@/lib/cn';

const compactFieldClassName = 'h-10 px-3 text-sm';

function CompactInput(props: InputProps) {
  return <Input {...props} className={cn(compactFieldClassName, props.className)} />;
}

function CompactSelect(props: SelectProps) {
  return <Select {...props} className={cn(compactFieldClassName, props.className)} />;
}

export interface PurchaseOrderLineItemsEditorProps {
  items: ApiItem[];
  taxRates: ApiTaxRate[];
  lines: POLineInput[];
  onChange: (lines: POLineInput[]) => void;
  isTaxInclusive: boolean;
  currencyCode: string;
  /** Read-only mode once the PO is no longer DRAFT. */
  disabled?: boolean;
}

/**
 * FR-04's line-item editor for the PO form — item picker (with current
 * stock shown inline once selected, per the spec's UX enhancement), qty,
 * price, tax rate, and a live per-line total preview (client-side only;
 * the server always recomputes authoritatively on save).
 */
export function PurchaseOrderLineItemsEditor({
  items,
  taxRates,
  lines,
  onChange,
  isTaxInclusive,
  currencyCode,
  disabled,
}: PurchaseOrderLineItemsEditorProps) {
  const { t } = useTranslation();

  function updateLine(index: number, patch: Partial<POLineInput>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, { itemId: '', orderedQty: '', expectedPrice: '' }]);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_auto] items-end gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        <span>{t('purchaseOrders.lines.item')}</span>
        <span>{t('purchaseOrders.lines.orderedQty')}</span>
        <span>{t('purchaseOrders.lines.expectedPrice')}</span>
        <span>{t('purchaseOrders.lines.taxRate')}</span>
        <span>{t('purchaseOrders.lines.lineTotal')}</span>
        <span />
      </div>

      {lines.map((line, index) => {
        const selectedItem = items.find((i) => i.id === line.itemId);
        const taxRate = taxRates.find((r) => r.id === line.taxRateId) ?? null;
        const preview = previewLineTax(line.orderedQty || '0', line.expectedPrice || '0', taxRate, isTaxInclusive);

        return (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_auto] items-start gap-2">
            <div className="flex flex-col gap-0.5">
              <CompactSelect
                disabled={disabled}
                value={line.itemId}
                onChange={(e) => updateLine(index, { itemId: e.target.value })}
              >
                <option value="">{t('purchaseOrders.lines.itemPlaceholder')}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </CompactSelect>
              {selectedItem && (
                <span className="text-xs text-foreground-muted">
                  {t('purchaseOrders.lines.currentStock', { stock: selectedItem.currentStock, unit: selectedItem.unit })}
                </span>
              )}
            </div>

            <CompactInput
              disabled={disabled}
              type="number"
              min="0"
              step="0.001"
              value={line.orderedQty}
              onChange={(e) => updateLine(index, { orderedQty: e.target.value })}
            />

            <CompactInput
              disabled={disabled}
              type="number"
              min="0"
              step="0.01"
              value={line.expectedPrice}
              onChange={(e) => updateLine(index, { expectedPrice: e.target.value })}
            />

            <CompactSelect
              disabled={disabled}
              value={line.taxRateId ?? ''}
              onChange={(e) => updateLine(index, { taxRateId: e.target.value || undefined })}
            >
              <option value="">{t('purchaseOrders.lines.noTax')}</option>
              {taxRates
                .filter((r) => r.isActive)
                .map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name} ({rate.ratePercent}%)
                  </option>
                ))}
            </CompactSelect>

            <span className="pt-2 text-sm font-medium text-foreground">
              {currencyCode} {preview.lineTotal}
            </span>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || lines.length <= 1}
              onClick={() => removeLine(index)}
              aria-label={t('purchaseOrders.lines.removeLine')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus className="h-4 w-4" />
          {t('purchaseOrders.lines.addLine')}
        </Button>
      )}
    </div>
  );
}
