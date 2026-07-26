import { Currency } from '../domain/currency.entity';

export interface CurrencyRepository {
  findAll(): Promise<Currency[]>;
  findByCode(code: string): Promise<Currency | null>;
  /** Used only by CurrencySeedService's one-time starter-set seed — there
   * is no user-facing create endpoint (spec only defines GET /currencies). */
  create(data: Currency): Promise<Currency>;
}
