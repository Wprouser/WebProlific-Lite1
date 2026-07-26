import { FUZZY_MATCH_THRESHOLD } from '../constants/enums';

/** Classic edit-distance DP — no external dependency needed for a
 * name-vs-name similarity check at this scale (a handful of candidates per
 * outlet, not a search-index workload). */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

/** 1.0 = identical (case/whitespace-insensitive), 0.0 = completely
 * dissimilar. */
export function similarityRatio(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (!normA || !normB) return 0;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(normA, normB) / maxLen;
}

export interface FuzzyCandidate {
  id: string;
  name: string;
}

/** Returns the best-scoring candidate's id, or null if nothing clears
 * FUZZY_MATCH_THRESHOLD — spec: an OCR guess that isn't confidently matched
 * must be left unmatched for manual review, never force-matched to the
 * closest (but still wrong) candidate. */
export function findBestFuzzyMatch(query: string | undefined, candidates: FuzzyCandidate[]): string | null {
  if (!query) return null;
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = similarityRatio(query, candidate.name);
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { id: candidate.id, score };
    }
  }
  return best?.id ?? null;
}
