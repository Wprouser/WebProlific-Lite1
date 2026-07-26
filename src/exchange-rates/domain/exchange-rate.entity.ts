export interface ExchangeRate {
  id: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: string;
  effectiveDate: Date;
  source: 'MANUAL' | 'API';
}
