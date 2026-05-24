import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

export type CollaboratorFeeStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "partially_paid"
  | "paid"
  | "cancelled";

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

export type CollaboratorFeeInput = {
  crewMemberId: string;
  projectId?: string | null;
  projectUnitId?: string | null;
  departmentId?: string | null;
  sourceAssignmentId?: string | null;
  feeType: string;
  description?: string | null;
  agreedAmount: number;
  currency: string;
  exchangeRate?: number | null;
  baseCurrencyAmount?: number | null;
  expectedPaymentDate?: string | null;
  notes?: string | null;
};

export type CreateCollaboratorFeeCommand = CollaboratorFeeInput & {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type UpdateCollaboratorFeeCommand = CollaboratorFeeInput & {
  commandId: string;
  workspaceId: string;
  feeId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ApproveCollaboratorFeeCommand = {
  commandId: string;
  workspaceId: string;
  feeId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type CancelCollaboratorFeeCommand = {
  commandId: string;
  workspaceId: string;
  feeId: string;
  reason?: string | null;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type RecordCollaboratorPaymentAllocation = {
  feeId: string;
  amount: number;
};

export type RecordCollaboratorPaymentCommand = {
  commandId: string;
  workspaceId: string;
  crewMemberId: string;
  paidAt: string;
  currency: string;
  exchangeRate?: number | null;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  allocations: RecordCollaboratorPaymentAllocation[];
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type SuggestCollaboratorFeesFromAssignmentsCommand = {
  workspaceId: string;
  projectId?: string | null;
  crewMemberId?: string | null;
};

export type CollaboratorFeeMutationResult = {
  commandId: string;
  feeId?: string;
  paymentBatchId?: string;
  repeated: boolean;
  summary: string;
};
