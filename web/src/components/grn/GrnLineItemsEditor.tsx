import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import type { ApiItem, ApiUnitOfMeasure } from '@/lib/items-api';
import type { ApiTaxRate } from '@/lib/tax-rates-api';
import type { GrnLineInput } from '@/lib/grn-api';
import { previewLineTax } from '@/lib/document-tax-preview';
import { cn } from '@/lib/cn';

const compactFieldClassName = 'h-10 px-3 text-sm';

function CompactInput(props: InputProps) {
  return <Input {...props} className={cn(compactFieldClassName, props.className)} />;
}

function CompactSelect(props: SelectProps) {
  return <Select {...props} className={cn(compactFieldClassName, props.className)} />;
}

export interface GrnLineItemsEditorProps {
  items: ApiItem[];
  units: ApiUnitOfMeasure[];
  taxRates: ApiTaxRate[];
  lines: GrnLineInput[];
  onChange: (lines: GrnLineInput[]) => void;
  isTaxInclusive: boolean;
  currencyCode: string;
  /** Against-a-PO flow (Flow 2): item + orderedQty come from the PO and
   * aren't editable here — only qty received / price / tax can be
   * accepted-as-is or overridden. Direct GRN (Flow 1) leaves everything
   * free-form, same as the PO line editor. */
  lockItemSelection?: boolean;
}

/**
 * FR-04's line-item editor shared by both GRN creation flows — item picker
 * (with current stock shown inline, per the spec's UX enhancement), qty
 * received, price, tax rate, and a live per-line total preview (client-side
 * only; the server always recomputes authoritatively on save).
 */
export function GrnLineItemsEditor({
  items,
  units,
  taxRates,
  lines,
  onChange,
  isTaxInclusive,
  currencyCode,
  lockItemSelection,
}: GrnLineItemsEditorProps) {
  const { t } = useTranslation();

  function updateLine(index: number, patch: Partial<GrnLineInput>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, { itemId: '', receivedQty: '', actualPrice: '' }]);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1fr_auto] items-end gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        <span>{t('grn.lines.item')}</span>
        {!lockItemSelection && <span />}
        {lockItemSelection && <span>{t('grn.lines.orderedQty')}</span>}
        <span>{t('grn.lines.receivedQty')}</span>
        <span>{t('grn.lines.actualPrice')}</span>
        <span>{t('purchaseOrders.lines.taxRate')}</span>
        <span>{t('purchaseOrders.lines.lineTotal')}</span>
        <span />
      </div>

      {lines.map((line, index) => {
        const selectedItem = items.find((i) => i.id === line.itemId);
        const taxRate = taxRates.find((r) => r.id === line.taxRateId) ?? null;
        const preview = previewLineTax(line.receivedQty || '0', line.actualPrice || '0', taxRate, isTaxInclusive);

        return (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1fr_auto] items-start gap-2">
            <div className="flex flex-col gap-0.5">
              {lockItemSelection ? (
                <span className="pt-2 text-sm font-medium text-foreground">
                  {selectedItem?.name ?? line.itemId}
                </span>
              ) : (
                <CompactSelect value={line.itemId} onChange={(e) => updateLine(index, { itemId: e.target.value })}>
                  <option value="">{t('purchaseOrders.lines.itemPlaceholder')}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </CompactSelect>
              )}
              {selectedItem && !lockItemSelection && (
                <span className="text-xs text-foreground-muted">
                  {t('purchaseOrders.lines.currentStock', {
                    stock: selectedItem.currentStock,
                    unit: units.find((u) => u.id === selectedItem.unitId)?.abbreviation ?? '',
                  })}
                </span>
              )}
            </div>

            {lockItemSelection && (
              <span className="pt-2 text-sm text-foreground-muted">{line.orderedQty ?? '—'}</span>
            )}

            <CompactInput
              type="number"
              min="0"
              step="0.001"
              value={line.receivedQty}
              onChange={(e) => updateLine(index, { receivedQty: e.target.value })}
            />

            <CompactInput
              type="number"
              min="0"
              step="0.01"
              value={line.actualPrice}
              onChange={(e) => updateLine(index, { actualPrice: e.target.value })}
            />

            <CompactSelect
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
              disabled={lines.length <= 1}
              onClick={() => removeLine(index)}
              aria-label={t('purchaseOrders.lines.removeLine')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {!lockItemSelection && (
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus className="h-4 w-4" />
          {t('purchaseOrders.lines.addLine')}
        </Button>
      )}
    </div>
  );
}
