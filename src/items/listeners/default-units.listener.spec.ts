import { DefaultUnitsListener } from './default-units.listener';
import { UnitOfMeasureRepository } from '../repositories/unit-of-measure.repository';
import { DEFAULT_BASE_UNITS, DEFAULT_DERIVED_UNITS } from '../constants/default-units';

describe('DefaultUnitsListener', () => {
  function buildListener() {
    // Echoes back a synthetic id derived from the name, so the second pass
    // (derived units) can be asserted against a real, resolvable id rather
    // than an opaque mock return value.
    const create = jest.fn().mockImplementation((data: { name: string }) =>
      Promise.resolve({ id: `id-${data.name}`, ...data }),
    );
    const unitRepository: Partial<UnitOfMeasureRepository> = { create };
    const listener = new DefaultUnitsListener(unitRepository as UnitOfMeasureRepository);
    return { listener, create };
  }

  it('AC: a new outlet is seeded with the full 8-unit starter set (kg, g, L, mL, pc, box, dz, pack)', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o1', baseCurrency: 'SAR' });

    expect(create).toHaveBeenCalledTimes(DEFAULT_BASE_UNITS.length + DEFAULT_DERIVED_UNITS.length);
    const abbreviations = create.mock.calls.map(([input]) => input.abbreviation);
    expect(abbreviations.sort()).toEqual(['kg', 'g', 'L', 'mL', 'pc', 'box', 'dz', 'pack'].sort());
  });

  it('seeds base units first, each with no baseUnitId/conversionFactor', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o1', baseCurrency: 'SAR' });

    for (const unit of DEFAULT_BASE_UNITS) {
      expect(create).toHaveBeenCalledWith({ name: unit.name, abbreviation: unit.abbreviation, outletId: 'o1' });
    }
  });

  it('AC: Litre and Kilogram are seeded as derived units resolving to their real base unit id', async () => {
    const { listener, create } = buildListener();
    await listener.handle({ outletId: 'o1', baseCurrency: 'SAR' });

    expect(create).toHaveBeenCalledWith({
      name: 'Litre',
      abbreviation: 'L',
      outletId: 'o1',
      baseUnitId: 'id-Millilitre',
      conversionFactor: '1000',
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Kilogram',
      abbreviation: 'kg',
      outletId: 'o1',
      baseUnitId: 'id-Gram',
      conversionFactor: '1000',
    });
  });
});
