import type { CommandActorType, CommandSourceChannel } from "./asset-commands";
import type { CurrencyRateSource, CurrencyRateType } from "./finance-currency-commands";

export type PackingSlipAssetSelection = {
  assetId: string;
  quantity: number;
};

export type CreatePackingSlipCommand = {
  commandId: string;
  workspaceId: string;
  actorUserId?: string;
  assetIds: string[];
  assetSelections?: PackingSlipAssetSelection[];
  sourceKitId?: string;
  projectId: string;
  projectUnitId?: string;
  departmentId?: string;
  responsibleUserId?: string;
  returnDueAt?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type CreatePackingSlipResult = {
  commandId: string;
  packingSlipId: string;
  slipNumber: string;
  processedAssetIds: string[];
  repeated: boolean;
  summary: string;
};

export type ReturnPackingSlipItemsCommand = {
  commandId: string;
  workspaceId: string;
  actorUserId?: string;
  packingSlipId: string;
  assetIds?: string[];
  conditionIn?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ReturnPackingSlipItemsResult = {
  commandId: string;
  packingSlipId: string;
  processedAssetIds: string[];
  repeated: boolean;
  slipStatus: string;
  summary: string;
};

export type PackingInsuranceCurrencyMode = "automatic" | "manual";

export type PackingInsuranceExportOptions = {
  /** Asset insured values are stored in USD today; outputCurrency controls the PDF presentation. */
  outputCurrency: "USD" | "DOP";
  exchangeRate: number;
  exchangeRateSource: CurrencyRateSource;
  exchangeRateType: CurrencyRateType;
  exchangeRateEffectiveDate?: string | null;
  exchangeRateSourceLabel?: string | null;
  mode: PackingInsuranceCurrencyMode;
};

export type ExportPackingSlipInsurancePdfInput = {
  packingSlipId: string;
  options?: PackingInsuranceExportOptions | null;
};
