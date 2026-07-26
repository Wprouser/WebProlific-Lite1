import { ExchangeRate } from '../domain/exchange-rate.entity';

export interface CreateExchangeRateInput {
  baseCurrency: string;
  targetCurrency: string;
  rate: string;
  // Always 'MANUAL' from the manual-entry endpoint this repository backs
  // today — 'API' is reserved for a future scheduled FX-sync job writing
  // directly, per spec's Business Logic note.
  source: 'MANUAL' | 'API';
}

export interface ExchangeRateFilters {
  baseCurrency?: string;
  targetCurrency?: string;
}

export interface ExchangeRateRepository {
  /** Append-only — there is no update/delete; a new rate is always a new
   * row with its own effectiveDate (defaults to now). */
  create(data: CreateExchangeRateInput): Promise<ExchangeRate>;
  /** The latest row per distinct (baseCurrency, targetCurrency) pair
   * matching the given filters — powers both the spec's single-pair
   * lookup (pass both filters) and the screen's table (pass just base). */
  findLatestPerPair(filters: ExchangeRateFilters): Promise<ExchangeRate[]>;
}
