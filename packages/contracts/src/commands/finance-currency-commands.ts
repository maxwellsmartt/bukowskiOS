import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

export type CurrencyRateType = "buy" | "sell" | "average" | "manual";
export type CurrencyRateSource = "manual" | "banco_popular" | "banco_central" | "custom";

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
