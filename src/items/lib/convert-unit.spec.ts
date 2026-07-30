import { convertUnitQuantity } from './convert-unit';

const millilitre = { id: 'ml', baseUnitId: null, conversionFactor: null };
const litre = { id: 'l', baseUnitId: 'ml', conversionFactor: '1000' };
const gram = { id: 'g', baseUnitId: null, conversionFactor: null };
const kilogram = { id: 'kg', baseUnitId: 'g', conversionFactor: '1000' };
const box = { id: 'box', baseUnitId: null, conversionFactor: null };

describe('convertUnitQuantity', () => {
  it('AC: converts derived -> base correctly (1.5 L = 1500 mL)', () => {
    expect(convertUnitQuantity('1.5', litre, millilitre)).toBe('1500.000');
  });

  it('AC: converts base -> derived correctly (1500 mL = 1.5 L)', () => {
    expect(convertUnitQuantity('1500', millilitre, litre)).toBe('1.500');
  });

  it('converts derived -> derived when they share the same base (via kg/g family, sanity on both directions)', () => {
    expect(convertUnitQuantity('2', kilogram, gram)).toBe('2000.000');
    expect(convertUnitQuantity('2000', gram, kilogram)).toBe('2.000');
  });

  it('a unit converted to itself is a no-op', () => {
    expect(convertUnitQuantity('5', litre, litre)).toBe('5.000');
  });

  it('AC: rejects converting between units from unrelated families (Kilogram and Litre)', () => {
    expect(() => convertUnitQuantity('1', kilogram, litre)).toThrow(/do not share a common base unit/);
  });

  it('AC: a unit with no base unit (e.g. Box) has no conversion capability — rejected, not silently wrong', () => {
    expect(() => convertUnitQuantity('1', box, kilogram)).toThrow(/do not share a common base unit/);
  });
});
