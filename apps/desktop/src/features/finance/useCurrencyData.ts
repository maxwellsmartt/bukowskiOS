import { useCallback, useEffect, useState } from "react";

import type {
  CurrencyRateType,
  CurrencySettingsRow,
  ExchangeRateRow,
} from "@contracts";

const fallbackSettings = (workspaceId: string): CurrencySettingsRow => ({
  id: `currency-settings-${workspaceId}`,
  workspaceId,
  baseCurrency: "DOP",
  defaultQuoteCurrency: "DOP",
  enabledCurrencies: ["DOP", "USD", "EUR"],
  defaultRateSource: "manual",
  defaultRateType: "manual",
  defaultItbisRate: 0.18,
  defaultQuoteValidityDays: 30,
  sirecineNumber: null,
  workspaceLogoUrl: null,
  workspaceSealUrl: null,
  workspaceSignatureUrl: null,
  createdAt: "",
  updatedAt: "",
});

export const useCurrencySettings = (workspaceId: string) => {
  const [data, setData] = useState<CurrencySettingsRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!workspaceId) {
      setData(null);
      return;
    }
    if (!window.bukowskiCurrency) {
      setData(fallbackSettings(workspaceId));
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiCurrency
      .getSettings(workspaceId)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load currency settings.");
          setData(fallbackSettings(workspaceId));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);

  return { data, isLoading, error, refresh };
};

export const useExchangeRates = (
  workspaceId: string,
  filter?: { baseCurrency?: string; quoteCurrency?: string; limit?: number },
) => {
  const [data, setData] = useState<ExchangeRateRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!workspaceId || !window.bukowskiCurrency) {
      setData([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.bukowskiCurrency
      .listRates({ workspaceId, ...filter })
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load rates.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, filter?.baseCurrency, filter?.quoteCurrency, filter?.limit, version]);

  return { data, isLoading, error, refresh };
};

export const fetchLatestRate = async (
  workspaceId: string,
  baseCurrency: string,
  quoteCurrency: string,
  rateType?: CurrencyRateType,
): Promise<ExchangeRateRow | null> => {
  if (!window.bukowskiCurrency) return null;
  return window.bukowskiCurrency.getLatestRate({ workspaceId, baseCurrency, quoteCurrency, rateType });
};
