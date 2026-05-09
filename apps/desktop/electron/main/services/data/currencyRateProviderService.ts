import type {
  CreateExchangeRateCommand,
  CurrencyRateProviderKey,
  CurrencyRateProviderStatus,
  CurrencyRateSource,
  ExchangeRateRow,
  RefreshCurrencyRatesCommand,
  RefreshCurrencyRatesResult,
} from "@contracts";

import type { ConnectorSecretStore } from "../ai/aiSecretStore";
import type { CurrencyMutationService } from "./currencyMutationService";
import type { CurrencyReadService } from "./currencyReadService";

const tasaRealSecretKey = "fx:tasareal";
const tasaRealBaseUrl = "https://tasareal.com/api/v1";

const sourceMap: Array<{
  source: CurrencyRateSource;
  label: string;
  aliases: string[];
}> = [
  {
    source: "banco_popular",
    label: "Banco Popular",
    aliases: ["popular", "banco popular", "banco popular dominicano"],
  },
  {
    source: "banco_central",
    label: "Banco Central",
    aliases: ["central", "bcrd", "banco central", "banco central de la republica dominicana"],
  },
  {
    source: "banco_santa_cruz",
    label: "Banco Santa Cruz",
    aliases: ["santa cruz", "santacruz", "santa_cruz", "banco santa cruz", "bancosantacruz", "banco_santa_cruz", "asociacion santa cruz", "bsc"],
  },
];

type TasaRealRatePayload = {
  id?: unknown;
  slug?: unknown;
  bank?: unknown;
  entity?: unknown;
  institution?: unknown;
  institution_name?: unknown;
  name?: unknown;
  full_name?: unknown;
  currency?: unknown;
  iso?: unknown;
  symbol?: unknown;
  code?: unknown;
  date?: unknown;
  buy?: unknown;
  buy_rate?: unknown;
  compra?: unknown;
  sell?: unknown;
  sell_rate?: unknown;
  venta?: unknown;
  rate?: unknown;
  average?: unknown;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const normalizeIdentityPart = (value: unknown): string => {
  if (!value || typeof value !== "object") return normalize(value);
  return Object.values(value as Record<string, unknown>).map(normalizeIdentityPart).join(" ");
};

const numberFrom = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const resolveSource = (row: TasaRealRatePayload) => {
  const identity = [
    row.id,
    row.slug,
    row.bank,
    row.entity,
    row.institution,
    row.institution_name,
    row.name,
    row.full_name,
  ]
    .map(normalizeIdentityPart)
    .join(" ");
  return sourceMap.find((source) => source.aliases.some((alias) => identity.includes(alias))) ?? null;
};

const rowsFromPayload = (payload: unknown): TasaRealRatePayload[] => {
  if (Array.isArray(payload)) return payload as TasaRealRatePayload[];
  if (payload && typeof payload === "object") {
    const objectPayload = payload as { rates?: unknown; data?: unknown };
    if (Array.isArray(objectPayload.rates)) return objectPayload.rates as TasaRealRatePayload[];
    if (Array.isArray(objectPayload.data)) return objectPayload.data as TasaRealRatePayload[];
    if (objectPayload.data && typeof objectPayload.data === "object") {
      return Object.values(objectPayload.data as Record<string, unknown>).filter(
        (row): row is TasaRealRatePayload => Boolean(row) && typeof row === "object",
      );
    }
  }
  return [];
};

const latestProviderRate = (rows: ExchangeRateRow[]) =>
  rows
    .filter((row) => sourceMap.some((source) => source.source === row.source))
    .sort((a, b) => {
      const fetchedCompare = (b.fetchedAt ?? "").localeCompare(a.fetchedAt ?? "");
      if (fetchedCompare !== 0) return fetchedCompare;
      return b.createdAt.localeCompare(a.createdAt);
    })[0] ?? null;

export const createCurrencyRateProviderService = (options: {
  currencyMutations: CurrencyMutationService;
  currencyReads: CurrencyReadService;
  secretStore: ConnectorSecretStore;
}) => {
  const hasApiKey = (workspaceId: string) => options.secretStore.hasConnectorSecret(workspaceId, tasaRealSecretKey);

  const buildStatus = (workspaceId: string): CurrencyRateProviderStatus => {
    const latestRate = latestProviderRate(options.currencyReads.listRates(workspaceId, { baseCurrency: "USD", quoteCurrency: "DOP", limit: 120 }));
    const configured = hasApiKey(workspaceId);
    return {
      workspaceId,
      provider: "tasareal",
      providerLabel: "TasaReal",
      hasApiKey: configured,
      lastFetchedAt: latestRate?.fetchedAt ?? null,
      lastEffectiveDate: latestRate?.effectiveDate ?? null,
      summary: configured
        ? latestRate?.fetchedAt
          ? `TasaReal connected. Last refresh ${latestRate.fetchedAt}.`
          : "TasaReal connected. Run refresh to pull the latest rates."
        : "Add a TasaReal API key to refresh rates automatically.",
    };
  };

  const saveConfig = (input: {
    workspaceId: string;
    provider: CurrencyRateProviderKey;
    apiKey?: string | null;
    clearApiKey?: boolean;
  }): CurrencyRateProviderStatus => {
    if (input.provider !== "tasareal") {
      throw new Error("Unsupported exchange-rate provider.");
    }
    if (input.clearApiKey) {
      options.secretStore.clearConnectorSecret(input.workspaceId, tasaRealSecretKey);
      return buildStatus(input.workspaceId);
    }
    if (input.apiKey?.trim()) {
      options.secretStore.setConnectorSecret(input.workspaceId, tasaRealSecretKey, input.apiKey);
    }
    return buildStatus(input.workspaceId);
  };

  const refreshRates = async (input: RefreshCurrencyRatesCommand): Promise<RefreshCurrencyRatesResult> => {
    if (input.provider !== "tasareal") {
      throw new Error("Unsupported exchange-rate provider.");
    }
    const apiKey = options.secretStore.getConnectorSecret(input.workspaceId, tasaRealSecretKey);
    if (!apiKey) {
      throw new Error("TasaReal API key is not configured.");
    }

    const currency = (input.currency ?? "USD").toUpperCase();
    const fetchedAt = new Date().toISOString();
    const response = await fetch(`${tasaRealBaseUrl}/rates?currency=${encodeURIComponent(currency)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`TasaReal refresh failed (${response.status}).`);
    }

    const payload = await response.json();
    const rows = rowsFromPayload(payload);
    let importedCount = 0;
    let skippedCount = 0;
    let effectiveDate: string | null = null;

    for (const row of rows) {
      const source = resolveSource(row);
      if (!source) {
        skippedCount += 1;
        continue;
      }
      const rowCurrency = normalizeIdentityPart(row.currency ?? row.iso ?? row.symbol ?? row.code).toUpperCase();
      if (rowCurrency && !rowCurrency.includes(currency)) {
        skippedCount += 1;
        continue;
      }

      const rowDate = typeof row.date === "string" && row.date.trim() ? row.date.trim() : fetchedAt.slice(0, 10);
      effectiveDate = effectiveDate ?? rowDate;
      const buy = numberFrom(row.buy, row.buy_rate, row.compra);
      const sell = numberFrom(row.sell, row.sell_rate, row.venta);
      const average = numberFrom(row.average, row.rate);
      const rateCommands: Array<Pick<CreateExchangeRateCommand, "rate" | "rateType">> = [];
      if (buy) rateCommands.push({ rate: buy, rateType: "buy" });
      if (sell) rateCommands.push({ rate: sell, rateType: "sell" });
      if (!buy && !sell && average) rateCommands.push({ rate: average, rateType: "average" });

      if (!rateCommands.length) {
        skippedCount += 1;
        continue;
      }

      for (const command of rateCommands) {
        options.currencyMutations.createRate({
          commandId: `${input.commandId}-${source.source}-${command.rateType}`,
          workspaceId: input.workspaceId,
          actorType: "integration",
          sourceChannel: "desktop",
          baseCurrency: currency,
          quoteCurrency: "DOP",
          rate: command.rate,
          rateType: command.rateType,
          source: source.source,
          sourceLabel: source.label,
          effectiveDate: rowDate,
          fetchedAt,
          notes: "Imported from TasaReal. Source: https://tasareal.com.",
        });
        importedCount += 1;
      }
    }

    return {
      commandId: input.commandId,
      workspaceId: input.workspaceId,
      provider: "tasareal",
      importedCount,
      skippedCount,
      effectiveDate,
      fetchedAt,
      summary: importedCount
        ? `Updated ${importedCount} exchange-rate value${importedCount === 1 ? "" : "s"} from TasaReal.`
        : "TasaReal responded, but no supported bank rates were found.",
    };
  };

  return {
    getStatus: (workspaceId: string) => buildStatus(workspaceId),
    refreshRates,
    saveConfig,
  };
};

export type CurrencyRateProviderService = ReturnType<typeof createCurrencyRateProviderService>;
