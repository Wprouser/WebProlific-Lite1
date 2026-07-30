import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { unitsApi, type ApiUnitOfMeasure } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';

export interface UnitManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: ApiUnitOfMeasure[];
  outletId: string | undefined;
  onCreate: (unit: ApiUnitOfMeasure) => void;
  onUpdate: (unit: ApiUnitOfMeasure) => void;
}

/** Trims trailing zeros for display only (e.g. "1000.000000" -> "1000") —
 * never used for the actual value sent to the API. */
function formatFactor(factor: string): string {
  return String(Number(factor));
}

/**
 * FR-01's Unit of Measure management — same modal-off-the-Items-screen
 * pattern as CategoryManagerModal, but with real Edit/Deactivate actions
 * (spec: "Add/Edit/Deactivate ... Name, Abbreviation, Base Unit if
 * applicable, Active status"), since units — unlike categories today —
 * support full soft-deactivation, and now an optional conversion
 * relationship to a genuine base unit (flat, two-level hierarchy only).
 */
export function UnitManagerModal({ open, onOpenChange, units, outletId, onCreate, onUpdate }: UnitManagerModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [baseUnitId, setBaseUnitId] = useState('');
  const [conversionFactor, setConversionFactor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAbbreviation, setEditAbbreviation] = useState('');
  const [editBaseUnitId, setEditBaseUnitId] = useState('');
  const [editConversionFactor, setEditConversionFactor] = useState('');
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Only genuine base units (baseUnitId: null) are offered as a Base Unit
  // choice — the flat, two-level-hierarchy rule means a derived unit can
  // never itself become another unit's base.
  const baseUnitOptions = units.filter((u) => u.baseUnitId === null);
  const unitById = (id: string) => units.find((u) => u.id === id);

  function resetCreateForm() {
    setName('');
    setAbbreviation('');
    setBaseUnitId('');
    setConversionFactor('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedAbbreviation = abbreviation.trim();
    if (!trimmedName || !trimmedAbbreviation || !outletId) return;
    setError(null);
    setSaving(true);
    try {
      const unit = await unitsApi.create({
        name: trimmedName,
        abbreviation: trimmedAbbreviation,
        outletId,
        baseUnitId: baseUnitId || undefined,
        conversionFactor: baseUnitId ? conversionFactor.trim() : undefined,
      });
      onCreate(unit);
      resetCreateForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.unitManager.saveError'));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(unit: ApiUnitOfMeasure) {
    setError(null);
    setEditingId(unit.id);
    setEditName(unit.name);
    setEditAbbreviation(unit.abbreviation);
    setEditBaseUnitId(unit.baseUnitId ?? '');
    setEditConversionFactor(unit.conversionFactor ? formatFactor(unit.conversionFactor) : '');
  }

  async function saveEdit(unit: ApiUnitOfMeasure) {
    const trimmedName = editName.trim();
    const trimmedAbbreviation = editAbbreviation.trim();
    if (!trimmedName || !trimmedAbbreviation) return;
    setError(null);
    setRowBusyId(unit.id);
    try {
      const updated = await unitsApi.update(unit.id, {
        name: trimmedName,
        abbreviation: trimmedAbbreviation,
        baseUnitId: editBaseUnitId || null,
        conversionFactor: editBaseUnitId ? editConversionFactor.trim() || null : null,
      });
      onUpdate(updated);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.unitManager.saveError'));
    } finally {
      setRowBusyId(null);
    }
  }

  async function toggleActive(unit: ApiUnitOfMeasure) {
    setError(null);
    setRowBusyId(unit.id);
    try {
      const updated = unit.isActive
        ? await unitsApi.deactivate(unit.id)
        : await unitsApi.update(unit.id, { isActive: true });
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.unitManager.saveError'));
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('items.unitManager.title')}
      description={t('items.unitManager.description')}
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={name}
            placeholder={t('items.unitManager.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className="max-w-28"
            value={abbreviation}
            placeholder={t('items.unitManager.abbreviationPlaceholder')}
            onChange={(e) => setAbbreviation(e.target.value)}
          />
          <Button type="submit" className="shrink-0" disabled={saving || !outletId}>
            {saving ? t('items.form.saving') : t('items.unitManager.add')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Select
            aria-label={t('items.unitManager.baseUnitPlaceholder')}
            value={baseUnitId}
            onChange={(e) => setBaseUnitId(e.target.value)}
          >
            <option value="">{t('items.unitManager.baseUnitPlaceholder')}</option>
            {baseUnitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.abbreviation})
              </option>
            ))}
          </Select>
          {baseUnitId && (
            <Input
              className="max-w-40"
              type="number"
              step="0.000001"
              min="0"
              value={conversionFactor}
              placeholder={t('items.unitManager.conversionFactorPlaceholder')}
              onChange={(e) => setConversionFactor(e.target.value)}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
            />
          )}
        </div>
      </form>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <ul className="mt-4 flex max-h-72 flex-col gap-1 overflow-y-auto">
        {units.length === 0 && (
          <li className="px-3 py-2 text-sm text-foreground-muted">{t('items.unitManager.empty')}</li>
        )}
        {units.map((unit) => (
          <li key={unit.id} className="rounded-md px-3 py-2 text-sm hover:bg-surface-secondary">
            {editingId === unit.id ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input className="h-9 flex-1 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <Input
                    className="h-9 max-w-24 text-sm"
                    value={editAbbreviation}
                    onChange={(e) => setEditAbbreviation(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Select
                    className="h-9 text-sm"
                    aria-label={t('items.unitManager.baseUnitPlaceholder')}
                    value={editBaseUnitId}
                    onChange={(e) => setEditBaseUnitId(e.target.value)}
                  >
                    <option value="">{t('items.unitManager.baseUnitPlaceholder')}</option>
                    {baseUnitOptions
                      .filter((u) => u.id !== unit.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.abbreviation})
                        </option>
                      ))}
                  </Select>
                  {editBaseUnitId && (
                    <Input
                      className="h-9 max-w-32 text-sm"
                      type="number"
                      step="0.000001"
                      min="0"
                      value={editConversionFactor}
                      placeholder={t('items.unitManager.conversionFactorPlaceholder')}
                      onChange={(e) => setEditConversionFactor(e.target.value)}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    />
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    {t('items.form.cancel')}
                  </Button>
                  <Button size="sm" disabled={rowBusyId === unit.id} onClick={() => saveEdit(unit)}>
                    {t('items.unitManager.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-foreground">
                  {unit.name} <span className="text-foreground-muted">({unit.abbreviation})</span>
                  {unit.baseUnitId && unit.conversionFactor && (
                    <span className="text-foreground-muted">
                      {' '}
                      — {t('items.unitManager.baseUnitLabel', {
                        thisAbbr: unit.abbreviation,
                        name: unitById(unit.baseUnitId)?.name ?? unit.baseUnitId,
                        factor: formatFactor(unit.conversionFactor),
                      })}
                    </span>
                  )}
                </span>
                <Badge variant={unit.isActive ? 'success-solid' : 'neutral'}>
                  {unit.isActive ? t('items.status.active') : t('items.status.inactive')}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('items.unitManager.edit')}
                  onClick={() => startEdit(unit)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={rowBusyId === unit.id}
                  aria-label={unit.isActive ? t('items.unitManager.deactivate') : t('items.unitManager.reactivate')}
                  onClick={() => toggleActive(unit)}
                >
                  {unit.isActive ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
