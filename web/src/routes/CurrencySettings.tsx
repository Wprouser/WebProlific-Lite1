import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ResponsiveTable, type ResponsiveTableColumn } from '@/components/ui/ResponsiveTable';
import { ChangeBaseCurrencyModal } from '@/components/currency/ChangeBaseCurrencyModal';
import { ExchangeRateFormModal } from '@/components/currency/ExchangeRateFormModal';
import { currenciesApi, type ApiCurrency } from '@/lib/currencies-api';
import { exchangeRatesApi, type ApiExchangeRate } from '@/lib/exchange-rates-api';
import { outletsApi, type ApiOutletCurrencySettings } from '@/lib/outlets-api';
import { getSession } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

// Mirrors the backend's own role gates (see ExchangeRatesController and
// OutletsController.updateCurrencySettings) — a UX convenience only, the
// RBAC guards server-side remain the actual enforcement boundary.
const RATE_MUTATE_ROLES = ['CHAIN_OWNER', 'PROPERTY_MANAGER'];
const BASE_CURRENCY_MUTATE_ROLES = ['CHAIN_OWNER'];

/**
 * FR-16's Currency & Exchange Rates screen. Two sections: this outlet's
 * base currency (per-outlet, heavily restricted to change) and the
 * Exchange Rates table (global/platform-wide data, filtered here to what's
 * relevant for this outlet's own base currency).
 */
export function CurrencySettings() {
  const { t } = useTranslation();
  const outletId = getSession()?.user.effectiveOutletIds[0];
  const role = getSession()?.user.effectiveRole ?? '';
  const canMutateRates = RATE_MUTATE_ROLES.includes(role);
  const canChangeBaseCurrency = BASE_CURRENCY_MUTATE_ROLES.includes(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencySettings, setCurrencySettings] = useState<ApiOutletCurrencySettings | null>(null);
  const [currencies, setCurrencies] = useState<ApiCurrency[]>([]);
  const [rates, setRates] = useState<ApiExchangeRate[]>([]);

  const [changeBaseCurrencyOpen, setChangeBaseCurrencyOpen] = useState(false);
  const [addRateOpen, setAddRateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!outletId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [settings, currencyList] = await Promise.all([
        outletsApi.getCurrencySettings(outletId),
        currenciesApi.list(),
      ]);
      setCurrencySettings(settings);
      setCurrencies(currencyList);
      // Only pairs relevant to this outlet — filtered to its own base
      // currency, not every global pair (spec's explicit ask, since the
      // full ExchangeRate table has no outlet concept at all).
      const rateList = await exchangeRatesApi.list({ base: settings.baseCurrency });
      setRates(rateList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('currency.loadError'));
    } finally {
      setLoading(false);
    }
  }, [outletId, t]);

  useEffect(() => {
    load();
  }, [load]);

  function currencyLabel(code: string): string {
    const currency = currencies.find((c) => c.code === code);
    return currency ? `${currency.code} — ${currency.name}` : code;
  }

  const columns: ResponsiveTableColumn<ApiExchangeRate>[] = [
    {
      key: 'baseCurrency',
      header: t('currency.table.baseCurrency'),
      render: (rate) => <span className="font-medium text-foreground">{rate.baseCurrency}</span>,
    },
    { key: 'targetCurrency', header: t('currency.table.targetCurrency'), render: (rate) => rate.targetCurrency },
    { key: 'rate', header: t('currency.table.rate'), render: (rate) => rate.rate },
    {
      key: 'effectiveDate',
      header: t('currency.table.effectiveDate'),
      render: (rate) => new Date(rate.effectiveDate).toLocaleString(),
    },
    {
      key: 'source',
      header: t('currency.table.source'),
      render: (rate) => (
        <Badge variant={rate.source === 'MANUAL' ? 'neutral' : 'info'}>
          {rate.source === 'MANUAL' ? t('currency.source.manual') : t('currency.source.api')}
        </Badge>
      ),
    },
    // No per-row edit/delete — ExchangeRate rows are append-only/historical
    // (see the module's own doc comment); "Actions" is kept as a column
    // for layout symmetry with the Tax Configuration table, currently empty.
    { key: 'actions', header: '', render: () => null },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">{t('currency.title')}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{t('currency.subtitle')}</p>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <EmptyState icon={<Coins className="h-7 w-7" />} title={t('currency.loadError')} description={error} />
      ) : !currencySettings ? null : (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t('currency.baseCurrencySection.title')}
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-2xl font-semibold text-foreground">
                {currencyLabel(currencySettings.baseCurrency)}
              </p>
              {canChangeBaseCurrency && (
                <Button variant="outline" onClick={() => setChangeBaseCurrencyOpen(true)}>
                  {t('currency.baseCurrencySection.change')}
                </Button>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">
                  {t('currency.ratesSection.title')}
                </h2>
                <p className="mt-1 text-sm text-foreground-muted">{t('currency.ratesSection.subtitle')}</p>
              </div>
              {canMutateRates && (
                <Button onClick={() => setAddRateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t('currency.ratesSection.addRate')}
                </Button>
              )}
            </div>

            {rates.length === 0 ? (
              <EmptyState
                icon={<Coins className="h-7 w-7" />}
                title={t('currency.ratesSection.empty.title')}
                description={t('currency.ratesSection.empty.description')}
                action={
                  canMutateRates ? (
                    <Button onClick={() => setAddRateOpen(true)}>{t('currency.ratesSection.addRate')}</Button>
                  ) : undefined
                }
              />
            ) : (
              <ResponsiveTable columns={columns} data={rates} getRowKey={(rate) => rate.id} />
            )}
          </section>

          {canChangeBaseCurrency && (
            <ChangeBaseCurrencyModal
              open={changeBaseCurrencyOpen}
              onOpenChange={setChangeBaseCurrencyOpen}
              outletId={outletId!}
              currentSettings={currencySettings}
              currencies={currencies}
              onSaved={() => {
                setChangeBaseCurrencyOpen(false);
                load();
              }}
            />
          )}

          {canMutateRates && (
            <ExchangeRateFormModal
              open={addRateOpen}
              onOpenChange={setAddRateOpen}
              currencies={currencies}
              defaultBaseCurrency={currencySettings.baseCurrency}
              onSaved={() => {
                setAddRateOpen(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
