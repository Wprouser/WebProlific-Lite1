import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnitManagerModal } from './UnitManagerModal';
import { unitsApi, type ApiUnitOfMeasure } from '@/lib/items-api';

vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return { ...actual, unitsApi: { ...actual.unitsApi, create: vi.fn(), update: vi.fn(), deactivate: vi.fn() } };
});

const millilitre: ApiUnitOfMeasure = {
  id: 'ml',
  outletId: 'o1',
  name: 'Millilitre',
  abbreviation: 'mL',
  baseUnitId: null,
  conversionFactor: null,
  isActive: true,
};
const litre: ApiUnitOfMeasure = {
  id: 'l',
  outletId: 'o1',
  name: 'Litre',
  abbreviation: 'L',
  baseUnitId: 'ml',
  conversionFactor: '1000.000000',
  isActive: true,
};
const box: ApiUnitOfMeasure = {
  id: 'box',
  outletId: 'o1',
  name: 'Box',
  abbreviation: 'box',
  baseUnitId: null,
  conversionFactor: null,
  isActive: true,
};

function renderModal(units: ApiUnitOfMeasure[] = [millilitre, litre, box]) {
  return render(
    <UnitManagerModal
      open
      onOpenChange={vi.fn()}
      units={units}
      outletId="o1"
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
    />,
  );
}

describe('UnitManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC: shows a derived unit\'s Base Unit relationship in the list', () => {
    renderModal();
    expect(screen.getByText(/1 L = 1000 Millilitre/)).toBeInTheDocument();
  });

  it('the Base Unit dropdown offers only genuine base units (never a derived unit like Litre)', () => {
    renderModal();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Millilitre (mL)');
    expect(options).toContain('Box (box)');
    expect(options).not.toContain('Litre (L)');
  });

  it('the Conversion Factor field only appears once a Base Unit is selected', async () => {
    renderModal();
    expect(screen.queryByPlaceholderText('Conversion factor')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Base unit (optional)'), 'ml');
    expect(screen.getByPlaceholderText('Conversion factor')).toBeInTheDocument();
  });

  it('AC: creating a derived unit sends baseUnitId and conversionFactor', async () => {
    (unitsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'kg',
      outletId: 'o1',
      name: 'Kilogram',
      abbreviation: 'kg',
      baseUnitId: 'ml',
      conversionFactor: '1000.000000',
      isActive: true,
    });
    renderModal();

    await userEvent.type(screen.getByPlaceholderText('New unit name (e.g. Bunch)'), 'Kilogram');
    await userEvent.type(screen.getByPlaceholderText('Abbr. (e.g. bunch)'), 'kg');
    await userEvent.selectOptions(screen.getByLabelText('Base unit (optional)'), 'ml');
    await userEvent.type(screen.getByPlaceholderText('Conversion factor'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(unitsApi.create).toHaveBeenCalledWith({
      name: 'Kilogram',
      abbreviation: 'kg',
      outletId: 'o1',
      baseUnitId: 'ml',
      conversionFactor: '1000',
    });
  });

  it('editing a unit excludes itself from its own Base Unit dropdown', async () => {
    renderModal();
    const editButtons = screen.getAllByLabelText('Edit');
    // Millilitre is the first row rendered — editing it should not offer
    // itself as its own base unit.
    await userEvent.click(editButtons[0]!);

    // Two selects now exist — the always-present create-form one (still
    // listing every base unit, including Millilitre, for a *new* unit) and
    // this row's own edit select, which must exclude Millilitre itself.
    const selects = screen.getAllByLabelText('Base unit (optional)');
    const editRowSelect = selects[1]!;
    const editRowOptions = Array.from(editRowSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(editRowOptions).not.toContain('Millilitre (mL)');
    expect(editRowOptions).toContain('Box (box)');
  });
});
