import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

export type FinanceEntryInput = {
  entryType: string;
  category: string;
  amount: number;
  currency?: string;
  exchangeRate?: number | null;
  baseCurrencyAmount?: number | null;
  status: string;
  projectId?: string | null;
  assetId?: string | null;
  incidentId?: string | null;
  entryDate: string;
  description?: string | null;
  notes?: string | null;
};

export type CreateFinancialEntryCommand = FinanceEntryInput & {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type UpdateFinancialEntryCommand = FinanceEntryInput & {
  commandId: string;
  workspaceId: string;
  entryId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type FinanceEntryMutationResult = {
  commandId: string;
  entryId: string;
  repeated: boolean;
  summary: string;
};
