import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { taxRatesApi, type ApiTaxRate } from '@/lib/tax-rates-api';
import { ApiError } from '@/lib/api-client';

export interface TaxRateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create; a tax rate = edit that rate. */
  taxRate: ApiTaxRate | null;
  outletId: string | undefined;
  onSaved: () => void;
}

// Small fixed list, matching the country-aware seeding table this form's
// suggestions ultimately feed — not a general-purpose country registry.
const COUNTRIES: { code: string; labelKey: string }[] = [
  { code: 'SA', labelKey: 'saudiArabia' },
  { code: 'AE', labelKey: 'uae' },
  { code: 'IN', labelKey: 'india' },
];

interface ComponentRow {
  componentName: string;
  componentRate: string;
}

function emptyComponentRows(): ComponentRow[] {
  // 2 rows by default — nudges toward the common CGST+SGST case. Not a
  // hard minimum: a single row (e.g. IGST) is still a valid save, since
  // the server only requires at least 1 component for a compound rate.
  return [
    { componentName: '', componentRate: '' },
    { componentName: '', componentRate: '' },
  ];
}

function sumComponentRates(components: ComponentRow[]): string {
  const sum = components.reduce((acc, c) => acc + (Number(c.componentRate) || 0), 0);
  return sum.toFixed(2);
}

/** FR-04's Tax Configuration Screen — create/edit form. Simple rates keep a
 * single editable Rate (%) field; toggling "Compound tax?" switches to a
 * repeatable component-rows list, with the overall rate becoming
 * read-only/auto-summed so it can never silently disagree with its parts. */
export function TaxRateFormModal({ open, onOpenChange, taxRate, outletId, onSaved }: TaxRateFormModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [isCompound, setIsCompound] = useState(false);
  const [ratePercent, setRatePercent] = useState('');
  const [components, setComponents] = useState<ComponentRow[]>(emptyComponentRows());
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(taxRate?.name ?? '');
    setCountryCode(taxRate?.countryCode ?? '');
    setIsCompound(taxRate?.isCompound ?? false);
    setRatePercent(taxRate?.ratePercent ?? '');
    setComponents(
      taxRate && taxRate.components.length > 0
        ? taxRate.components.map((c) => ({ componentName: c.componentName, componentRate: c.componentRate }))
        : emptyComponentRows(),
    );
    setIsActive(taxRate?.isActive ?? true);
  }, [open, taxRate]);

  const computedRatePercent = isCompound ? sumComponentRates(components) : ratePercent;

  function handleCompoundToggle(next: boolean) {
    setIsCompound(next);
    if (next && components.every((c) => !c.componentName && !c.componentRate)) {
      setComponents(emptyComponentRows());
    }
  }

  function updateComponent(index: number, field: keyof ComponentRow, value: string) {
    setComponents((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function addComponent() {
    setComponents((prev) => [...prev, { componentName: '', componentRate: '' }]);
  }

  function removeComponent(index: number) {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name,
        ratePercent: computedRatePercent,
        isCompound,
        countryCode: countryCode || undefined,
        components: isCompound
          ? components
              .filter((c) => c.componentName.trim() && c.componentRate.trim())
              .map((c) => ({ componentName: c.componentName.trim(), componentRate: c.componentRate }))
          : undefined,
      };
      if (taxRate) {
        await taxRatesApi.update(taxRate.id, { ...payload, isActive });
      } else {
        if (!outletId) return;
        await taxRatesApi.create({ outletId, ...payload });
      }
      onSaved();
    } catch (err) {
      // 403s carry the raw RBAC guard message (role names, outlet UUIDs) —
      // never surface that verbatim. The Tax Configuration screen itself
      // hides Save/Add entirely for unauthorized roles; this is only a
      // defense-in-depth fallback (e.g. a role change mid-session).
      if (err instanceof ApiError && err.status === 403) {
        setError(t('taxRates.form.permissionError'));
      } else {
        setError(err instanceof ApiError ? err.message : t('taxRates.form.saveError'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={taxRate ? t('taxRates.form.editTitle') : t('taxRates.form.createTitle')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('taxRates.form.name')}>
          <Input
            required
            value={name}
            placeholder={t('taxRates.form.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('taxRates.form.country')}>
          <Select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
            <option value="">{t('taxRates.form.countryPlaceholder')}</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {t(`taxRates.countries.${c.labelKey}`)}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-start gap-2.5 rounded-md border border-border-strong p-3.5">
          <input
            type="checkbox"
            checked={isCompound}
            onChange={(e) => handleCompoundToggle(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm text-foreground-muted">
            <span className="block font-medium text-foreground">{t('taxRates.form.compoundToggle')}</span>
            {t('taxRates.form.compoundToggleHint')}
          </span>
        </label>

        {isCompound ? (
          <div className="flex flex-col gap-3 rounded-md border border-border-strong p-3.5">
            <p className="text-sm font-medium text-foreground">{t('taxRates.form.componentsTitle')}</p>
            {components.map((component, index) => (
              <div key={index} className="flex items-end gap-2">
                <Field label={t('taxRates.form.componentName')} className="flex-1">
                  <Input
                    required
                    value={component.componentName}
                    placeholder={t('taxRates.form.componentNamePlaceholder')}
                    onChange={(e) => updateComponent(index, 'componentName', e.target.value)}
                  />
                </Field>
                <Field label={t('taxRates.form.componentRate')} className="w-28">
                  <Input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={component.componentRate}
                    onChange={(e) => updateComponent(index, 'componentRate', e.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={components.length <= 1}
                  onClick={() => removeComponent(index)}
                  aria-label={t('taxRates.form.removeComponent')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addComponent}>
              <Plus className="h-4 w-4" />
              {t('taxRates.form.addComponent')}
            </Button>

            <Field label={t('taxRates.form.ratePercent')}>
              <Input required readOnly disabled value={computedRatePercent} />
            </Field>
            <p className="text-xs text-foreground-muted">{t('taxRates.form.autoSumHint')}</p>
          </div>
        ) : (
          <Field label={t('taxRates.form.ratePercent')}>
            <Input
              required
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
            />
          </Field>
        )}

        {taxRate && (
          <label className="flex items-center gap-2.5 rounded-md border border-border-strong p-3.5">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">{t('taxRates.form.activeToggle')}</span>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('taxRates.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving || (!taxRate && !outletId)}>
            {saving ? t('taxRates.form.saving') : t('taxRates.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
