import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

export type CurrencyRateType = "buy" | "sell" | "average" | "manual";
export type CurrencyRateSource = "manual" | "banco_popular" | "banco_central" | "banco_santa_cruz" | "custom";

export type CurrencySettingsRow = {
  id: string;
  workspaceId: string;
  baseCurrency: string;
  defaultQuoteCurrency: string;
  enabledCurrencies: string[];
  defaultRateSource: CurrencyRateSource;
  defaultRateType: CurrencyRateType;
  defaultItbisRate: number;
  defaultQuoteValidityDays: number;
  sirecineNumber: string | null;
  workspaceLogoUrl: string | null;
  workspaceSealUrl: string | null;
  workspaceSignatureUrl: string | null;
  /**
   * Dominican NCF (Número de Comprobante Fiscal) state used when issuing
   * invoices. `ncfSeriesActive` is the prefix (e.g. "B01"); each issue
   * consumes `ncfSequenceNext` and bumps it. `ncfSequenceMax` is the
   * highest sequence allowed in this series (DGII allocates a range);
   * `ncfExpiresAt` is the DGII expiry date for the series so we can warn
   * before it lapses.
   */
  ncfSeriesActive: string | null;
  ncfSequenceNext: number | null;
  ncfSequenceMax: number | null;
  ncfExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExchangeRateRow = {
  id: string;
  workspaceId: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  rateType: CurrencyRateType;
  source: CurrencyRateSource;
  sourceLabel: string | null;
  effectiveDate: string;
  fetchedAt: string | null;
  createdByUserId: string | null;
  notes: string | null;
  createdAt: string;
};

export type UpsertCurrencySettingsCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  baseCurrency: string;
  defaultQuoteCurrency: string;
  enabledCurrencies: string[];
  defaultRateSource: CurrencyRateSource;
  defaultRateType: CurrencyRateType;
  defaultItbisRate: number;
  defaultQuoteValidityDays: number;
  sirecineNumber?: string | null;
  workspaceLogoUrl?: string | null;
  workspaceSealUrl?: string | null;
  workspaceSignatureUrl?: string | null;
  ncfSeriesActive?: string | null;
  ncfSequenceNext?: number | null;
  ncfSequenceMax?: number | null;
  ncfExpiresAt?: string | null;
};

export type CreateExchangeRateCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  rateType: CurrencyRateType;
  source: CurrencyRateSource;
  sourceLabel?: string | null;
  effectiveDate: string;
  fetchedAt?: string | null;
  notes?: string | null;
};

export type DeleteExchangeRateCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  rateId: string;
};

export type CurrencyRateProviderKey = "tasareal";

export type CurrencyRateProviderStatus = {
  workspaceId: string;
  provider: CurrencyRateProviderKey;
  providerLabel: string;
  hasApiKey: boolean;
  lastFetchedAt: string | null;
  lastEffectiveDate: string | null;
  summary: string;
};

export type SaveCurrencyRateProviderConfigCommand = {
  workspaceId: string;
  provider: CurrencyRateProviderKey;
  apiKey?: string | null;
  clearApiKey?: boolean;
};

export type RefreshCurrencyRatesCommand = {
  commandId: string;
  workspaceId: string;
  provider: CurrencyRateProviderKey;
  currency?: string;
};

export type CurrencySettingsMutationResult = {
  commandId: string;
  workspaceId: string;
  repeated: boolean;
  summary: string;
};

export type ExchangeRateMutationResult = {
  commandId: string;
  rateId: string;
  repeated: boolean;
  summary: string;
};

export type RefreshCurrencyRatesResult = {
  commandId: string;
  workspaceId: string;
  provider: CurrencyRateProviderKey;
  importedCount: number;
  skippedCount: number;
  effectiveDate: string | null;
  fetchedAt: string;
  summary: string;
};
