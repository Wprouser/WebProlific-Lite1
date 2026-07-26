import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';
import { Select, type SelectProps } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { suppliersApi, type ApiSupplier } from '@/lib/suppliers-api';
import { type ApiCurrency } from '@/lib/currencies-api';
import { ApiError } from '@/lib/api-client';

// Matches ItemFormModal's own compacting — this form has enough fields
// (general/address/currency-tax/payment-bank) to warrant the same
// tighter density as that one, not the taller touch-first default.
const compactFieldClassName = 'h-10 px-3 text-sm';

function CompactInput(props: InputProps) {
  return <Input {...props} className={cn(compactFieldClassName, props.className)} />;
}

function CompactSelect(props: SelectProps) {
  return <Select {...props} className={cn(compactFieldClassName, props.className)} />;
}

export interface SupplierFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create; a supplier = edit that supplier. */
  supplier: ApiSupplier | null;
  currencies: ApiCurrency[];
  outletId: string | undefined;
  onSaved: () => void;
}

interface FormState {
  name: string;
  supplierCode: string;
  contactPerson: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  stateOrProvince: string;
  countryCode: string;
  postalCode: string;
  preferredCurrency: string;
  taxRegistrationType: string;
  taxRegistrationNumber: string;
  paymentTerms: string;
  leadTimeDays: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfscOrSwift: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  supplierCode: '',
  contactPerson: '',
  phone: '',
  email: '',
  addressLine: '',
  city: '',
  stateOrProvince: '',
  countryCode: '',
  postalCode: '',
  preferredCurrency: '',
  taxRegistrationType: '',
  taxRegistrationNumber: '',
  paymentTerms: '',
  leadTimeDays: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfscOrSwift: '',
  isActive: true,
};

function toFormState(supplier: ApiSupplier | null): FormState {
  if (!supplier) return EMPTY_FORM;
  return {
    name: supplier.name,
    supplierCode: supplier.supplierCode ?? '',
    contactPerson: supplier.contactPerson ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    addressLine: supplier.addressLine ?? '',
    city: supplier.city ?? '',
    stateOrProvince: supplier.stateOrProvince ?? '',
    countryCode: supplier.countryCode ?? '',
    postalCode: supplier.postalCode ?? '',
    preferredCurrency: supplier.preferredCurrency ?? '',
    taxRegistrationType: supplier.taxRegistrationType ?? '',
    taxRegistrationNumber: supplier.taxRegistrationNumber ?? '',
    paymentTerms: supplier.paymentTerms ?? '',
    leadTimeDays: supplier.leadTimeDays !== null ? String(supplier.leadTimeDays) : '',
    bankAccountName: supplier.bankAccountName ?? '',
    bankAccountNumber: supplier.bankAccountNumber ?? '',
    bankIfscOrSwift: supplier.bankIfscOrSwift ?? '',
    isActive: supplier.isActive,
  };
}

/** FR-03's Supplier Management — create/edit form. Every field beyond
 * name is optional, including both tax-registration fields together (per
 * spec AC: "neither is required to create a supplier, since some small
 * local suppliers may not be tax-registered at all"). */
export function SupplierFormModal({ open, onOpenChange, supplier, currencies, outletId, onSaved }: SupplierFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(toFormState(supplier));
  }, [open, supplier]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        supplierCode: form.supplierCode || undefined,
        contactPerson: form.contactPerson || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        addressLine: form.addressLine || undefined,
        city: form.city || undefined,
        stateOrProvince: form.stateOrProvince || undefined,
        countryCode: form.countryCode || undefined,
        postalCode: form.postalCode || undefined,
        preferredCurrency: form.preferredCurrency || undefined,
        taxRegistrationType: form.taxRegistrationType || undefined,
        taxRegistrationNumber: form.taxRegistrationNumber || undefined,
        paymentTerms: form.paymentTerms || undefined,
        leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : undefined,
        bankAccountName: form.bankAccountName || undefined,
        bankAccountNumber: form.bankAccountNumber || undefined,
        bankIfscOrSwift: form.bankIfscOrSwift || undefined,
      };
      if (supplier) {
        await suppliersApi.update(supplier.id, { ...payload, isActive: form.isActive });
      } else {
        if (!outletId) return;
        await suppliersApi.create({ outletId, ...payload });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t('suppliers.form.permissionError'));
      } else {
        setError(err instanceof ApiError ? err.message : t('suppliers.form.saveError'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={supplier ? t('suppliers.form.editTitle') : t('suppliers.form.createTitle')}
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <SectionHeading first>{t('suppliers.form.sectionGeneral')}</SectionHeading>
        <Field label={t('suppliers.form.name')} required>
          <CompactInput required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.supplierCode')}>
            <CompactInput
              value={form.supplierCode}
              placeholder={t('suppliers.form.supplierCodePlaceholder')}
              onChange={(e) => set('supplierCode', e.target.value)}
            />
          </Field>
          <Field label={t('suppliers.form.contactPerson')}>
            <CompactInput value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.phone')}>
            <CompactInput value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t('suppliers.form.email')}>
            <CompactInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>

        <SectionHeading>{t('suppliers.form.sectionAddress')}</SectionHeading>
        <Field label={t('suppliers.form.addressLine')}>
          <CompactInput value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.city')}>
            <CompactInput value={form.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label={t('suppliers.form.stateOrProvince')}>
            <CompactInput
              value={form.stateOrProvince}
              placeholder={t('suppliers.form.stateOrProvincePlaceholder')}
              onChange={(e) => set('stateOrProvince', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.countryCode')}>
            <CompactInput
              maxLength={2}
              placeholder={t('suppliers.form.countryCodePlaceholder')}
              value={form.countryCode}
              onChange={(e) => set('countryCode', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('suppliers.form.postalCode')}>
            <CompactInput value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
          </Field>
        </div>

        <SectionHeading>{t('suppliers.form.sectionCurrencyTax')}</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.preferredCurrency')}>
            <CompactSelect
              value={form.preferredCurrency}
              onChange={(e) => set('preferredCurrency', e.target.value)}
            >
              <option value="">{t('suppliers.form.preferredCurrencyPlaceholder')}</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </CompactSelect>
          </Field>
          <Field label={t('suppliers.form.paymentTerms')}>
            <CompactInput
              value={form.paymentTerms}
              placeholder={t('suppliers.form.paymentTermsPlaceholder')}
              onChange={(e) => set('paymentTerms', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.taxRegistrationType')}>
            <CompactInput
              value={form.taxRegistrationType}
              placeholder={t('suppliers.form.taxRegistrationTypePlaceholder')}
              onChange={(e) => set('taxRegistrationType', e.target.value)}
            />
          </Field>
          <Field label={t('suppliers.form.taxRegistrationNumber')}>
            <CompactInput
              value={form.taxRegistrationNumber}
              onChange={(e) => set('taxRegistrationNumber', e.target.value)}
            />
          </Field>
        </div>

        <SectionHeading>{t('suppliers.form.sectionPaymentBank')}</SectionHeading>
        <Field label={t('suppliers.form.leadTimeDays')}>
          <CompactInput
            type="number"
            min="0"
            className="max-w-32"
            value={form.leadTimeDays}
            onChange={(e) => set('leadTimeDays', e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('suppliers.form.bankAccountName')}>
            <CompactInput value={form.bankAccountName} onChange={(e) => set('bankAccountName', e.target.value)} />
          </Field>
          <Field label={t('suppliers.form.bankAccountNumber')}>
            <CompactInput
              value={form.bankAccountNumber}
              onChange={(e) => set('bankAccountNumber', e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('suppliers.form.bankIfscOrSwift')}>
          <CompactInput value={form.bankIfscOrSwift} onChange={(e) => set('bankIfscOrSwift', e.target.value)} />
        </Field>

        {supplier && (
          <label className="mt-1 flex items-center gap-2.5 rounded-md border border-border-strong p-3.5">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">{t('suppliers.form.activeToggle')}</span>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('suppliers.form.cancel')}
          </Button>
          <Button type="submit" disabled={saving || (!supplier && !outletId)}>
            {saving ? t('suppliers.form.saving') : t('suppliers.form.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function SectionHeading({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <h3
      className={cn(
        'text-xs font-semibold uppercase tracking-wide text-foreground-muted',
        !first && 'mt-1 border-t border-border pt-3',
      )}
    >
      {children}
    </h3>
  );
}
