import { findBestFuzzyMatch, similarityRatio } from './fuzzy-match';

describe('similarityRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityRatio('Basmati Rice', 'Basmati Rice')).toBe(1);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(similarityRatio('  Basmati Rice  ', 'basmati rice')).toBe(1);
  });

  it('returns a partial score for a close-but-not-exact match', () => {
    const score = similarityRatio('Basmati Rice', 'Basmati Rce');
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 for completely dissimilar strings', () => {
    expect(similarityRatio('Basmati Rice', 'Xyz')).toBeLessThan(0.3);
  });

  it('returns 0 when either input is empty', () => {
    expect(similarityRatio('', 'Basmati Rice')).toBe(0);
    expect(similarityRatio('Basmati Rice', '')).toBe(0);
  });
});

describe('findBestFuzzyMatch', () => {
  const candidates = [
    { id: 'i1', name: 'Basmati Rice' },
    { id: 'i2', name: 'Brown Sugar' },
    { id: 'i3', name: 'Basmati Rice 5kg' },
  ];

  it('AC: returns the best-scoring candidate above the confidence threshold', () => {
    expect(findBestFuzzyMatch('Basmati Rice', candidates)).toBe('i1');
  });

  it('AC: returns null when the query is undefined (nothing to match)', () => {
    expect(findBestFuzzyMatch(undefined, candidates)).toBeNull();
  });

  it('AC: returns null when no candidate clears the confidence threshold', () => {
    expect(findBestFuzzyMatch('Completely Unrelated Item Name', candidates)).toBeNull();
  });

  it('picks the closer of two plausible candidates', () => {
    expect(findBestFuzzyMatch('Basmati Rice', candidates)).toBe('i1');
  });
});
