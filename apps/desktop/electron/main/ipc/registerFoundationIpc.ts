import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  archiveProjectSchema,
  archiveAssetSchema,
  assignAgentModelSchema,
  assignCrewToProjectUnitSchema,
  assignMoveAssetsSchema,
  createAgentSchema,
  createAssetSchema,
  createAssistantThreadSchema,
  createCatalogEntitySchema,
  createConnectorLinkTokenSchema,
  createCollaboratorFeeSchema,
  deleteCatalogEntitiesSchema,
  createDraftRunFromChatSchema,
  createExchangeRateSchema,
  currencyRateProviderStatusReadArgsSchema,
  createFinancialEntrySchema,
  createInvoiceSchema,
  createInvoiceFromQuoteSchema,
  createQuoteSchema,
  currencySettingsReadArgsSchema,
  deleteExchangeRateSchema,
  duplicateQuoteSchema,
  cancelInvoiceSchema,
  cancelCollaboratorFeeSchema,
  collaboratorFeeDetailReadArgsSchema,
  collaboratorFeeListReadArgsSchema,
  collaboratorFeeSummaryReadArgsSchema,
  collaboratorFeeSuggestionsReadArgsSchema,
  invoiceDetailReadArgsSchema,
  invoiceListReadArgsSchema,
  issueInvoiceSchema,
  approveCollaboratorFeeSchema,
  upsertBankAccountSchema,
  upsertPaymentInstrumentSchema,
  deactivatePaymentInstrumentSchema,
  importStatementSchema,
  addManualTransactionsSchema,
  deleteImportSchema,
  correctTransactionSchema,
  annotateTransactionSchema,
  applyCounterpartyRuleSchema,
  setAllocationsSchema,
  reviewReimbursementSchema,
  linkTransactionSchema,
  assignInvoiceAllocationSchema,
  linkInvoiceAllocationToTransactionSchema,
  unlinkInvoiceAllocationSchema,
  rejectInvoiceAllocationSchema,
  markInvoiceAllocationReimbursedSchema,
  createCardSettlementSchema,
  undoTreasuryActionSchema,
  enqueueInvoiceBatchSchema,
  invoiceInboxListReadArgsSchema,
  invoiceInboxPreviewReadArgsSchema,
  downloadInvoiceExtractionSchema,
  downloadInvoiceExtractionBatchSchema,
  invoiceInboxDuplicatesReadArgsSchema,
  backfillInvoiceHashesSchema,
  updateInvoiceExtractionSchema,
  bulkLinkInvoiceExtractionsSchema,
  retryInvoiceExtractionsSchema,
  upsertSoftwareLicenseSchema,
  archiveSoftwareLicenseSchema,
  setLicenseSeatsSchema,
  softwareLicensesReadArgsSchema,
  applyInvoiceExtractionSchema,
  dismissInvoiceExtractionSchema,
  treasuryAccountsReadArgsSchema,
  treasuryExpenseCategoriesReadArgsSchema,
  treasuryImportsReadArgsSchema,
  treasuryTransactionListReadArgsSchema,
  counterpartyRulePreviewReadArgsSchema,
  treasuryOverviewReadArgsSchema,
  treasuryOverviewQuerySchema,
  treasuryReviewQueueReadArgsSchema,
  treasuryProjectPnlReadArgsSchema,
  treasuryUndoPreviewReadArgsSchema,
  treasuryDeductibleLedgerReadArgsSchema,
  treasuryReimbursementsReadArgsSchema,
  treasuryDeductibleLedgerExportSchema,
  dgiiReportReadArgsSchema,
  dgiiReportExportSchema,
  restoreQuoteFromVersionSchema,
  exchangeRateListReadArgsSchema,
  latestExchangeRateReadArgsSchema,
  quoteDetailReadArgsSchema,
  quoteExportPdfReadArgsSchema,
  quoteListReadArgsSchema,
  quoteVersionsReadArgsSchema,
  setQuoteStatusSchema,
  updateQuoteSchema,
  upsertCurrencySettingsSchema,
  createPackingSlipSchema,
  createProjectBlueprintReadArgsSchema,
  createProjectBlueprintSchema,
  createProjectSchema,
  createProjectUnitSchema,
  createRmaCaseSchema,
  idReadArgsSchema,
  deleteAssistantThreadSchema,
  deleteCatalogEntitySchema,
  exportCatalogCsvSchema,
  deleteProjectSchema,
  deleteProjectUnitSchema,
  emptyReadArgsSchema,
  financeEntryListReadArgsSchema,
  financeOverviewReadArgsSchema,
  globalSearchReadArgsSchema,
  assetListReadArgsSchema,
  assetWorkspaceReadArgsSchema,
  incidentListReadArgsSchema,
  packingSlipListReadArgsSchema,
  projectListReadArgsSchema,
  catalogListReadArgsSchema,
  recordInvoicePaymentSchema,
  recordCollaboratorPaymentSchema,
  renumberInvoiceSchema,
  renumberQuoteSchema,
  recordRuntimeErrorSchema,
  reportIncidentSchema,
  resolveIncidentSchema,
  returnPackingSlipItemsSchema,
  importCatalogCsvSchema,
  previewCatalogCsvImportSchema,
  rmaSnapshotReadArgsSchema,
  reviewAgentRunSchema,
  refreshAiProviderModelsSchema,
  refreshCurrencyRatesSchema,
  saveAiProviderConfigSchema,
  saveCurrencyRateProviderConfigSchema,
  saveConnectorConfigSchema,
  sendAssistantChatTurnSchema,
  setActiveAssistantThreadSchema,
  setAgentApprovalModeSchema,
  setAgentStatusSchema,
  testConnectorConnectionSchema,
  testAiProviderConnectionSchema,
  transcribeAssistantAudioSchema,
  unarchiveProjectSchema,
  renameAssistantThreadSchema,
  unassignCrewFromProjectUnitSchema,
  updateAgentSchema,
  updateAssetSchema,
  updateAssistantThreadPreferencesSchema,
  updateCatalogEntitySchema,
  updateIncidentSchema,
  updateFinancialEntrySchema,
  updateCollaboratorFeeSchema,
  updateInvoiceSchema,
  updateProjectSchema,
  updateProjectUnitSchema,
  updateRmaCaseSchema,
  scheduleTimelineReadArgsSchema,
  uploadCrewCatalogDocumentsReadArgsSchema,
  DEFAULT_WORKSPACE_ID,
} from "@contracts";
import type {
  AssistantChatSnapshot,
  AssignAgentModelCommand,
  CreateAssistantThreadCommand,
  AssistantGatewayRequest,
  SaveAIProviderConfigCommand,
  RefreshAIProviderModelsCommand,
  SaveConnectorConfigCommand,
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  AssistantGatewayResponse,
  AssistantAudioTranscriptionResult,
  DeleteAssistantThreadCommand,
  CreateAgentCommand,
  ArchiveAssetCommand,
  ArchiveProjectInput,
  CreateDraftRunFromChatCommand,
  CreateConnectorLinkTokenCommand,
  RecordRuntimeErrorCommand,
  ReviewAgentRunCommand,
  SendAssistantChatTurnCommand,
  TranscribeAssistantAudioCommand,
  AssetListQuery,
  AssetWorkspaceQuery,
  SetActiveAssistantThreadCommand,
  RenameAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  SetAgentApprovalModeCommand,
  SetAgentStatusCommand,
  AssignMoveAssetsInput,
  AssignCrewToProjectUnitInput,
  CatalogListQuery,
  CatalogCsvImportResult,
  CatalogCsvImportPreview,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreateFinancialEntryCommand,
  CreateCollaboratorFeeCommand,
  CreatePackingSlipCommand,
  CreateProjectBlueprintInput,
  CreateRmaCaseCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteCatalogEntitiesInput,
  ExportCatalogCsvInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  CollaboratorFeeListQuery,
  CollaboratorFeeMutationResult,
  FinanceOverviewQuery,
  FinanceEntryMutationResult,
  FileUploadMutationResult,
  GlobalSearchQuery,
  IncidentListQuery,
  PackingSlipListQuery,
  ProjectListQuery,
  ReportIncidentCommand,
  ResolveIncidentCommand,
  ReturnPackingSlipItemsCommand,
  RmaSnapshotQuery,
  ScheduleTimelineQuery,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  UnarchiveProjectInput,
  UnassignCrewFromProjectUnitInput,
  PreviewCatalogCsvImportInput,
  ImportCatalogCsvInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateCollaboratorFeeCommand,
  ApproveCollaboratorFeeCommand,
  CancelCollaboratorFeeCommand,
  RecordCollaboratorPaymentCommand,
  UpdateIncidentCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  UpdateAgentCommand,
} from "@contracts";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";
import type { WorkspaceAccessGuard } from "../services/auth/workspaceAccessGuard";
import { safeHandle, safeHandleRead, safeHandleReadWithSchema } from "./ipcSafeHandler";
import {
  buildDeductibleLedgerCsv,
  buildDeductibleLedgerFileBaseName,
  buildDeductibleLedgerXlsx,
  createDeductibleLedgerPdf,
} from "../services/data/treasuryDeductibleLedgerExportService";
import {
  buildDgiiReportCsv,
  buildDgiiReportFileBaseName,
  buildDgiiReportXlsx,
  createDgiiReportPdf,
} from "../services/data/dgiiReportExportService";

type RegisterFoundationIpcOptions = {
  foundationReads: FoundationReadService;
  agentReads: {
    getMissionControlSnapshot: () => unknown;
    getAgentsList: () => unknown;
    getAgentDetail: (agentId: string) => unknown;
    getRunsList: () => unknown;
    getModelsSnapshot: () => unknown;
    getAIProviderConfigs: () => unknown;
    getConnectorsSnapshot: () => unknown;
  };
  projectMutations: {
    createProject: (input: CreateProjectInput) => void;
    createProjectBlueprint: (input: CreateProjectBlueprintInput) => void;
    updateProject: (input: UpdateProjectInput) => void;
    archiveProject: (input: ArchiveProjectInput) => void;
    unarchiveProject: (input: UnarchiveProjectInput) => void;
    deleteProject: (input: DeleteProjectInput) => void;
    createProjectUnit: (input: CreateProjectUnitInput) => void;
    updateProjectUnit: (input: UpdateProjectUnitInput) => void;
    deleteProjectUnit: (input: DeleteProjectUnitInput) => void;
    assignCrewToProjectUnit: (input: AssignCrewToProjectUnitInput) => void;
    unassignCrewFromProjectUnit: (input: UnassignCrewFromProjectUnitInput) => void;
  };
  catalogMutations: {
    createEntity: (input: CreateCatalogEntityInput) => void;
    updateEntity: (input: UpdateCatalogEntityInput) => void;
    deleteEntity: (input: DeleteCatalogEntityInput) => void;
    deleteEntities: (input: DeleteCatalogEntitiesInput) => void;
    buildCsvExport: (input: ExportCatalogCsvInput) => { fileName: string; csvText: string };
    previewCsvImport: (input: PreviewCatalogCsvImportInput) => CatalogCsvImportPreview;
    importCsv: (input: ImportCatalogCsvInput) => CatalogCsvImportResult;
  };
  assetMutations: {
    assignMoveAssets: (input: AssignMoveAssetsInput) => unknown;
    createAsset: (input: CreateAssetCommand) => unknown;
    updateAsset: (input: UpdateAssetCommand) => unknown;
    archiveAsset: (input: ArchiveAssetCommand) => unknown;
  };
  workspaceAccess: WorkspaceAccessGuard;
  fileUploads: {
    importAssetFiles: (assetId: string, sourceFilePaths: string[]) => FileUploadMutationResult;
    importIncidentFiles: (incidentId: string, sourceFilePaths: string[]) => unknown;
    importFinanceDocuments: (entryId: string, sourceFilePaths: string[]) => unknown;
    importCrewDocuments: (crewMemberId: string, sourceFilePaths: string[]) => unknown;
    openAssetFile: (fileId: string) => Promise<void>;
    deleteAssetFile: (fileId: string) => { deletedCount: number; summary: string };
    openIncidentFile: (fileId: string) => Promise<void>;
    openFinanceDocument: (fileId: string) => Promise<void>;
    openCrewDocument: (fileId: string) => Promise<void>;
    deleteCrewDocument: (fileId: string) => { deletedCount: number; summary: string };
  };
  incidentMutations: {
    reportIncident: (input: ReportIncidentCommand) => unknown;
    updateIncident: (input: UpdateIncidentCommand) => unknown;
    resolveIncident: (input: ResolveIncidentCommand) => unknown;
  };
  financeMutations: {
    createEntry: (input: CreateFinancialEntryCommand) => FinanceEntryMutationResult;
    updateEntry: (input: UpdateFinancialEntryCommand) => FinanceEntryMutationResult;
  };
  collaboratorFeeMutations: {
    createFee: (input: CreateCollaboratorFeeCommand) => CollaboratorFeeMutationResult;
    updateFee: (input: UpdateCollaboratorFeeCommand) => CollaboratorFeeMutationResult;
    approveFee: (input: ApproveCollaboratorFeeCommand) => CollaboratorFeeMutationResult;
    cancelFee: (input: CancelCollaboratorFeeCommand) => CollaboratorFeeMutationResult;
    recordPayment: (input: RecordCollaboratorPaymentCommand) => CollaboratorFeeMutationResult;
  };
  collaboratorFeeReads: {
    listFees: (query?: CollaboratorFeeListQuery) => unknown;
    getFeeDetail: (workspaceId: string, feeId: string) => unknown;
    getSummary: (input: { workspaceId: string; projectId?: string | null }) => unknown;
    suggestFromAssignments: (input: { workspaceId: string; projectId?: string | null; crewMemberId?: string | null }) => unknown;
  };
  currencyMutations: {
    upsertSettings: (
      input: import("@contracts").UpsertCurrencySettingsCommand,
    ) => import("@contracts").CurrencySettingsMutationResult;
    createRate: (
      input: import("@contracts").CreateExchangeRateCommand,
    ) => import("@contracts").ExchangeRateMutationResult;
    deleteRate: (
      input: import("@contracts").DeleteExchangeRateCommand,
    ) => import("@contracts").ExchangeRateMutationResult;
  };
  currencyReads: {
    getSettings: (workspaceId: string) => import("@contracts").CurrencySettingsRow;
    listRates: (
      workspaceId: string,
      filter?: { baseCurrency?: string; quoteCurrency?: string; limit?: number },
    ) => import("@contracts").ExchangeRateRow[];
    getLatestRate: (
      workspaceId: string,
      baseCurrency: string,
      quoteCurrency: string,
      rateType?: import("@contracts").CurrencyRateType,
    ) => import("@contracts").ExchangeRateRow | null;
  };
  currencyRateProviders: {
    getStatus: (workspaceId: string) => import("@contracts").CurrencyRateProviderStatus;
    saveConfig: (
      input: import("@contracts").SaveCurrencyRateProviderConfigCommand,
    ) => import("@contracts").CurrencyRateProviderStatus;
    refreshRates: (
      input: import("@contracts").RefreshCurrencyRatesCommand,
    ) => Promise<import("@contracts").RefreshCurrencyRatesResult>;
  };
  quoteMutations: {
    createQuote: (input: import("@contracts").CreateQuoteCommand) => import("@contracts").QuoteMutationResult;
    updateQuote: (input: import("@contracts").UpdateQuoteCommand) => import("@contracts").QuoteMutationResult;
    setStatus: (input: import("@contracts").SetQuoteStatusCommand) => import("@contracts").QuoteMutationResult;
    duplicateQuote: (input: import("@contracts").DuplicateQuoteCommand) => import("@contracts").QuoteMutationResult;
    deleteQuote: (input: import("@contracts").DuplicateQuoteCommand) => import("@contracts").QuoteMutationResult;
    renumberQuote: (input: import("@contracts").RenumberQuoteCommand) => import("@contracts").QuoteMutationResult;
    restoreQuoteFromVersion: (
      input: import("@contracts").RestoreQuoteFromVersionCommand,
    ) => import("@contracts").QuoteMutationResult;
  };
  quoteReads: {
    listQuotes: (filter: import("@contracts").QuoteListFilter) => import("@contracts").QuoteRow[];
    getQuoteDetail: (workspaceId: string, quoteId: string) => import("@contracts").QuoteDetail | null;
    listQuoteVersions: (
      workspaceId: string,
      quoteId: string,
    ) => Array<{
      id: string;
      versionNumber: number;
      changeSummary: string | null;
      createdAt: string;
      createdByUserId: string | null;
      snapshot: Record<string, unknown>;
    }>;
  };
  invoiceMutations: {
    createInvoice: (input: import("@contracts").CreateInvoiceCommand) => import("@contracts").InvoiceMutationResult;
    updateInvoice: (input: import("@contracts").UpdateInvoiceCommand) => import("@contracts").InvoiceMutationResult;
    issueInvoice: (input: import("@contracts").IssueInvoiceCommand) => import("@contracts").InvoiceMutationResult;
    cancelInvoice: (input: import("@contracts").CancelInvoiceCommand) => import("@contracts").InvoiceMutationResult;
    recordInvoicePayment: (
      input: import("@contracts").RecordInvoicePaymentCommand,
    ) => import("@contracts").InvoiceMutationResult;
    renumberInvoice: (input: import("@contracts").RenumberInvoiceCommand) => import("@contracts").InvoiceMutationResult;
    createInvoiceFromQuote: (
      quote: import("@contracts").QuoteDetail,
      options: {
        commandId: string;
        actorType: import("@contracts").CreateInvoiceCommand["actorType"];
        sourceChannel: import("@contracts").CreateInvoiceCommand["sourceChannel"];
        issueDate?: string;
        paymentTermsDays?: number;
      },
    ) => import("@contracts").InvoiceMutationResult;
  };
  invoiceReads: {
    listInvoices: (filter: import("@contracts").InvoiceListFilter) => import("@contracts").InvoiceRow[];
    getInvoiceDetail: (
      workspaceId: string,
      invoiceId: string,
    ) => import("@contracts").InvoiceDetail | null;
  };
  treasuryMutations: {
    upsertBankAccount: (
      input: import("@contracts").UpsertBankAccountCommand,
    ) => import("@contracts").BankAccountMutationResult;
    deactivatePaymentInstrument: (
      input: import("@contracts").DeactivatePaymentInstrumentCommand,
    ) => import("@contracts").BankAccountMutationResult;
    importStatement: (
      input: import("@contracts").ImportStatementCommand,
    ) => import("@contracts").ImportStatementResult;
    addManualTransactions: (
      input: import("@contracts").AddManualTransactionsCommand,
    ) => import("@contracts").ImportStatementResult;
    deleteImport: (
      input: import("@contracts").DeleteImportCommand,
    ) => import("@contracts").TransactionMutationResult;
    correctTransaction: (
      input: import("@contracts").CorrectTransactionCommand,
    ) => import("@contracts").TransactionMutationResult;
    annotateTransaction: (
      input: import("@contracts").AnnotateTransactionCommand,
    ) => import("@contracts").TransactionMutationResult;
    applyCounterpartyRule: (
      input: import("@contracts").ApplyCounterpartyRuleCommand,
    ) => import("@contracts").ApplyCounterpartyRuleResult;
    setAllocations: (
      input: import("@contracts").SetAllocationsCommand,
    ) => import("@contracts").TransactionMutationResult;
    reviewReimbursement: (
      input: import("@contracts").ReviewReimbursementCommand,
    ) => import("@contracts").TransactionMutationResult;
    linkTransaction: (
      input: import("@contracts").LinkTransactionCommand,
    ) => import("@contracts").TransactionMutationResult;
    assignInvoiceAllocation: (
      input: import("@contracts").AssignInvoiceAllocationCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    linkInvoiceAllocationToTransaction: (
      input: import("@contracts").LinkInvoiceAllocationToTransactionCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    unlinkInvoiceAllocation: (
      input: import("@contracts").UnlinkInvoiceAllocationCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    rejectInvoiceAllocation: (
      input: import("@contracts").RejectInvoiceAllocationCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    markInvoiceAllocationReimbursed: (
      input: import("@contracts").MarkInvoiceAllocationReimbursedCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    createCardSettlement: (
      input: import("@contracts").CreateCardSettlementCommand,
    ) => import("@contracts").InvoiceAllocationMutationResult;
    undoLastAction: (
      input: import("@contracts").UndoTreasuryActionCommand,
    ) => import("@contracts").TransactionMutationResult;
  };
  treasuryReads: {
    getAccounts: (workspaceId: string) => import("@contracts").BankAccountRow[];
    listTransactions: (
      query: import("@contracts").TreasuryTransactionListQuery,
    ) => import("@contracts").BankTransactionRow[];
    previewClassificationRule: (
      query: import("@contracts").CounterpartyRulePreviewQuery,
    ) => import("@contracts").CounterpartyRulePreview;
    listImports: (
      workspaceId: string,
      bankAccountId?: string,
    ) => import("@contracts").BankStatementImportRow[];
    getOverview: (
      query: import("@contracts").TreasuryOverviewQuery,
    ) => import("@contracts").TreasuryOverviewSnapshot;
    getReviewQueue: (workspaceId: string) => import("@contracts").ReviewQueueRow[];
    getProjectPnl: (
      workspaceId: string,
      dateFrom?: string,
      dateTo?: string,
    ) => import("@contracts").ProjectPnlRow[];
    listExpenseCategories: (workspaceId: string) => string[];
    getUndoPreview: (workspaceId: string) => import("@contracts").TreasuryUndoPreview;
    getDeductibleLedger: (
      query: import("@contracts").TreasuryDeductibleLedgerQuery,
    ) => import("@contracts").TreasuryDeductibleLedger;
    getReimbursements: (
      query: import("@contracts").TreasuryReimbursementsQuery,
    ) => import("@contracts").TreasuryReimbursementsSnapshot;
    getDgiiReport: (query: import("@contracts").DgiiReportQuery) => import("@contracts").DgiiReport;
  };
  invoiceInbox: {
    enqueue: (
      input: import("@contracts").EnqueueInvoiceBatchCommand,
    ) => Promise<import("@contracts").EnqueueInvoiceBatchResult>;
    list: (
      query: import("@contracts").InvoiceInboxListQuery,
    ) => import("@contracts").InvoiceExtraction[];
    update: (
      input: import("@contracts").UpdateInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    bulkLink: (
      input: import("@contracts").BulkLinkInvoiceExtractionsCommand,
    ) => import("@contracts").BulkLinkInvoiceExtractionsResult;
    retry: (
      input: import("@contracts").RetryInvoiceExtractionsCommand,
    ) => import("@contracts").RetryInvoiceExtractionsResult;
    apply: (
      input: import("@contracts").ApplyInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    dismiss: (
      input: import("@contracts").DismissInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    getFileBuffer: (
      id: string,
    ) => Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null>;
    getDownload: (
      workspaceId: string,
      extractionId: string,
    ) => Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null>;
    buildBatchZip: (
      workspaceId: string,
      extractionIds: string[],
    ) => Promise<{ buffer: Buffer; fileName: string; includedCount: number; missingCount: number } | null>;
    findDuplicateGroups: (workspaceId: string) => import("@contracts").InvoiceDuplicateGroup[];
    backfillContentHashes: (workspaceId: string, limit?: number) => Promise<number>;
  };
  softwareLicenses: {
    listLicenses: (workspaceId: string) => import("@contracts").SoftwareLicenseRow[];
    upsertLicense: (
      input: import("@contracts").UpsertSoftwareLicenseCommand,
    ) => import("@contracts").SoftwareLicenseMutationResult;
    archiveLicense: (
      input: import("@contracts").ArchiveSoftwareLicenseCommand,
    ) => import("@contracts").SoftwareLicenseMutationResult;
    setSeats: (
      input: import("@contracts").SetLicenseSeatsCommand,
    ) => import("@contracts").SoftwareLicenseMutationResult;
  };
  exportQuotePdf: (
    workspaceId: string,
    quoteId: string,
  ) => Promise<{ fileName: string; mimeType: "application/pdf"; buffer: Buffer }>;
  exportInvoicePdf: (
    workspaceId: string,
    invoiceId: string,
  ) => Promise<{ fileName: string; mimeType: "application/pdf"; buffer: Buffer }>;
  packingMutations: {
    createPackingSlip: (input: CreatePackingSlipCommand) => unknown;
    returnPackingSlipItems: (input: ReturnPackingSlipItemsCommand) => unknown;
  };
  exportPackingSlipPdf: (
    packingSlipId: string,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
  exportPackingSlipInsurancePdf: (
    packingSlipId: string,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
  exportFinanceReportPdf: (
    query: FinanceOverviewQuery | undefined,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
      buffer: Buffer;
      targetFilePath: string;
    }>;
  exportTreasuryOverviewPdf: (
    query: import("@contracts").TreasuryOverviewQuery,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
  exportProjectBlueprintPdf: (
    input: CreateProjectBlueprintInput,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
  rmaMutations: {
    createRmaCase: (input: CreateRmaCaseCommand) => unknown;
    updateRmaCase: (input: UpdateRmaCaseCommand) => unknown;
  };
  agentMutations: {
    createAgent: (input: CreateAgentCommand) => unknown;
    updateAgent: (input: UpdateAgentCommand) => unknown;
    setAgentStatus: (input: SetAgentStatusCommand) => unknown;
    setAgentApprovalMode: (input: SetAgentApprovalModeCommand) => unknown;
    saveAIProviderConfig: (input: SaveAIProviderConfigCommand) => unknown;
    refreshAIProviderModels: (input: RefreshAIProviderModelsCommand) => unknown;
    saveConnectorConfig: (input: SaveConnectorConfigCommand) => unknown;
    testAIProviderConnection: (input: TestAIProviderConnectionCommand) => unknown;
    testConnectorConnection: (input: TestConnectorConnectionCommand) => unknown;
    createConnectorLinkToken: (input: CreateConnectorLinkTokenCommand) => unknown;
    assignAgentModel: (input: AssignAgentModelCommand) => unknown;
    getAssistantChatSnapshot: () => AssistantChatSnapshot;
    createAssistantThread: (input: CreateAssistantThreadCommand) => AssistantChatSnapshot;
    deleteAssistantThread: (input: DeleteAssistantThreadCommand) => AssistantChatSnapshot;
    setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) => AssistantChatSnapshot;
    updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) => AssistantChatSnapshot;
    renameAssistantThread: (input: RenameAssistantThreadCommand) => AssistantChatSnapshot;
    sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) => Promise<AssistantChatSnapshot>;
    reviewRun: (input: ReviewAgentRunCommand) => unknown;
    sendAssistantMessage: (input: AssistantGatewayRequest) => Promise<AssistantGatewayResponse>;
    createDraftRunFromChat: (input: CreateDraftRunFromChatCommand) => unknown;
  };
  assistantAudioTranscription: {
    transcribeDataUrl: (input: TranscribeAssistantAudioCommand) => Promise<AssistantAudioTranscriptionResult>;
  };
  runtimeDiagnostics: {
    recordRuntimeError: (input: RecordRuntimeErrorCommand) => unknown;
  };
};

const sanitizePdfFileNamePart = (value: string | null | undefined, fallback: string) => {
  const sanitized = (value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");

  return sanitized || fallback;
};

const buildPackingSlipPdfFileName = (
  slip: {
    number: string;
    projectCode: string;
    project: string;
    departmentCode: string;
    issueDateCompact: string;
  },
  prefix: "PS" | "IL",
) => {
  const slipNumericId = slip.number.replace(/^PS[-_\s]*/i, "");
  const slipLabel = `${prefix}-${sanitizePdfFileNamePart(slipNumericId, slip.number)}`;
  const projectCode = sanitizePdfFileNamePart(slip.projectCode, "NO-PROJECT");
  const projectName = sanitizePdfFileNamePart(slip.project, "Unassigned");
  const departmentCode = sanitizePdfFileNamePart(slip.departmentCode, "NO-DEPT");
  const issuedDate = sanitizePdfFileNamePart(slip.issueDateCompact, "undated");

  return `${slipLabel}_${projectCode}_${projectName}_${departmentCode}_Packing_${issuedDate}.pdf`;
};

const workspaceQueryReadArgsSchema = z.tuple([
  z.object({ workspaceId: z.string().trim().min(1) }).strict(),
]);

const requireWorkspaceId = (query: { workspaceId?: string | null } | undefined, action: string) => {
  const workspaceId = query?.workspaceId?.trim();
  if (!workspaceId) {
    throw new Error(`Select a workspace before you ${action}.`);
  }
  return workspaceId;
};

export const registerFoundationIpc = ({
  foundationReads,
  agentReads,
  projectMutations,
  catalogMutations,
  assetMutations,
  workspaceAccess,
  fileUploads,
  incidentMutations,
  financeMutations,
  collaboratorFeeMutations,
  collaboratorFeeReads,
  currencyMutations,
  currencyReads,
  currencyRateProviders,
  quoteMutations,
  quoteReads,
  invoiceMutations,
  invoiceReads,
  treasuryMutations,
  treasuryReads,
  invoiceInbox,
  softwareLicenses,
  exportInvoicePdf,
  exportQuotePdf,
  packingMutations,
  exportFinanceReportPdf,
  exportTreasuryOverviewPdf,
  exportPackingSlipPdf,
  exportPackingSlipInsurancePdf,
  exportProjectBlueprintPdf,
  rmaMutations,
  agentMutations,
  assistantAudioTranscription,
  runtimeDiagnostics,
}: RegisterFoundationIpcOptions) => {
  const normalizeProjectListQuery = (query: ProjectListQuery | undefined): ProjectListQuery => ({
    workspaceId: query?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    search: query?.search ?? "",
    sortBy: query?.sortBy ?? "name",
    sortDirection: query?.sortDirection ?? "asc",
    includeArchived: query?.includeArchived,
  });

  const canReadFinanceForWorkspace = async (workspaceId: string) => {
    try {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "load finance fields",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return true;
    } catch {
      return false;
    }
  };

  const getProjectListForWorkspace = async (query: ProjectListQuery) => {
    const scopedQuery = normalizeProjectListQuery(query);
    const workspaceId = scopedQuery.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const includeFinancials = await canReadFinanceForWorkspace(workspaceId);
    const safeQuery =
      includeFinancials || scopedQuery.sortBy !== "exposure"
        ? scopedQuery
        : { ...scopedQuery, sortBy: "name" as const, sortDirection: "asc" as const };

    return foundationReads.getProjects(safeQuery, { includeFinancials });
  };

  const getProjectDetailForWorkspace = async (workspaceId: string, projectId: string) => {
    const includeFinancials = await canReadFinanceForWorkspace(workspaceId);
    return foundationReads.getProjectDetail(projectId, { includeFinancials });
  };

  const assertAgentWorkspaceAccess = (
    input: { workspaceId: string },
    action: string,
    requiredPermission?: string,
  ) =>
    workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action,
      accessLevel: "write",
      requiredPermission,
    });

  const withTrustedAssistantActor = async <T extends AssistantGatewayRequest>(input: T): Promise<T> => {
    const actorUserId = await workspaceAccess.getCurrentUserId("send assistant messages");
    return {
      ...input,
      context: {
        ...input.context,
        sourceActorUserId: actorUserId,
        userPermissions: undefined,
      },
      source: input.source
        ? {
            ...input.source,
            actorUserId,
          }
        : {
            connectorKey: "desktop",
            actorName: "Desktop user",
            permissionSummary: "Authenticated workspace member",
            isLinkedIdentity: true,
            actorUserId,
          },
    };
  };

  const assertAgentAdminAccess = (input: { workspaceId: string }, action: string) =>
    // Existing admin-like permission used by workspace administration screens.
    // TODO(security): introduce a dedicated `agents.manage` permission in the
    // remote and local role seeds, then switch these checks to that key.
    assertAgentWorkspaceAccess(input, action, "users.invite");

  safeHandleReadWithSchema(
    ipcChannels.shell.getBootstrap,
    emptyReadArgsSchema,
    () => foundationReads.getShellBootstrap(),
    "The app could not load the shell bootstrap.",
  );
  safeHandleReadWithSchema(
    ipcChannels.shell.searchGlobal,
    globalSearchReadArgsSchema,
    async (_event, query: GlobalSearchQuery) => {
      if (!query.workspaceId) {
        throw new Error("Select a workspace before searching.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "search this workspace",
        accessLevel: "read",
      });

      return foundationReads.getGlobalSearch(query);
    },
    "The app could not complete that search.",
  );
  safeHandleRead(
    ipcChannels.agents.getMissionControlSnapshot,
    () => agentReads.getMissionControlSnapshot(),
    "The app could not load Mission Control.",
  );
  safeHandleRead(ipcChannels.agents.getAgentsList, () => agentReads.getAgentsList(), "The app could not load the agents list.");
  safeHandleRead(
    ipcChannels.agents.getAgentDetail,
    (_event, agentId: string) => agentReads.getAgentDetail(agentId),
    "The app could not load that agent.",
  );
  safeHandleRead(ipcChannels.agents.getRunsList, () => agentReads.getRunsList(), "The app could not load the run history.");
  safeHandleRead(
    ipcChannels.agents.getModelsSnapshot,
    () => agentReads.getModelsSnapshot(),
    "The app could not load the models snapshot.",
  );
  safeHandleRead(
    ipcChannels.agents.getAIProviderConfigs,
    () => agentReads.getAIProviderConfigs(),
    "The app could not load AI provider settings.",
  );
  safeHandleRead(
    ipcChannels.agents.getConnectorsSnapshot,
    () => agentReads.getConnectorsSnapshot(),
    "The app could not load the connectors snapshot.",
  );
  safeHandleRead(
    ipcChannels.agents.getAssistantChatSnapshot,
    () => agentMutations.getAssistantChatSnapshot(),
    "The app could not load the assistant chat.",
  );
  safeHandle(ipcChannels.agents.create, createAgentSchema, async (_event, input) => {
    await assertAgentAdminAccess(input, "create agents");
    return agentMutations.createAgent(input);
  });
  safeHandle(ipcChannels.agents.update, updateAgentSchema, async (_event, input) => {
    await assertAgentAdminAccess(input, "update agents");
    return agentMutations.updateAgent(input);
  });
  safeHandle(ipcChannels.agents.setStatus, setAgentStatusSchema, async (_event, input) => {
    await assertAgentAdminAccess(input, "change agent status");
    return agentMutations.setAgentStatus(input);
  });
  safeHandle(
    ipcChannels.agents.setApprovalMode,
    setAgentApprovalModeSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "change agent approval mode");
      return agentMutations.setAgentApprovalMode(input);
    },
  );
  safeHandle(
    ipcChannels.agents.saveAIProviderConfig,
    saveAiProviderConfigSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "save AI provider settings");
      return agentMutations.saveAIProviderConfig(input);
    },
  );
  safeHandle(
    ipcChannels.agents.saveConnectorConfig,
    saveConnectorConfigSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "save connector settings");
      return agentMutations.saveConnectorConfig(input);
    },
  );
  safeHandle(
    ipcChannels.agents.testAIProviderConnection,
    testAiProviderConnectionSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "test AI provider settings");
      return agentMutations.testAIProviderConnection(input);
    },
  );
  safeHandle(
    ipcChannels.agents.refreshAIProviderModels,
    refreshAiProviderModelsSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "refresh AI provider models");
      return agentMutations.refreshAIProviderModels(input);
    },
  );
  safeHandle(
    ipcChannels.agents.testConnectorConnection,
    testConnectorConnectionSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "test connector settings");
      return agentMutations.testConnectorConnection(input);
    },
  );
  safeHandle(
    ipcChannels.agents.createConnectorLinkToken,
    createConnectorLinkTokenSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "create connector link tokens");
      return agentMutations.createConnectorLinkToken(input);
    },
  );
  safeHandle(
    ipcChannels.agents.assignAgentModel,
    assignAgentModelSchema,
    async (_event, input) => {
      await assertAgentAdminAccess(input, "assign agent models");
      return agentMutations.assignAgentModel(input);
    },
  );
  safeHandle(
    ipcChannels.agents.createAssistantThread,
    createAssistantThreadSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "create assistant threads");
      return agentMutations.createAssistantThread(input);
    },
  );
  safeHandle(
    ipcChannels.agents.deleteAssistantThread,
    deleteAssistantThreadSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "delete assistant threads");
      return agentMutations.deleteAssistantThread(input);
    },
  );
  safeHandle(
    ipcChannels.agents.setActiveAssistantThread,
    setActiveAssistantThreadSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "switch assistant threads");
      return agentMutations.setActiveAssistantThread(input);
    },
  );
  safeHandle(
    ipcChannels.agents.updateAssistantThreadPreferences,
    updateAssistantThreadPreferencesSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "update assistant thread preferences");
      return agentMutations.updateAssistantThreadPreferences(input);
    },
  );
  safeHandle(
    ipcChannels.agents.renameAssistantThread,
    renameAssistantThreadSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "rename assistant threads");
      return agentMutations.renameAssistantThread(input);
    },
  );
  safeHandle(
    ipcChannels.agents.sendAssistantChatTurn,
    sendAssistantChatTurnSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "send assistant messages");
      return agentMutations.sendAssistantChatTurn(await withTrustedAssistantActor(input));
    },
  );
  safeHandle(
    ipcChannels.agents.transcribeAudio,
    transcribeAssistantAudioSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "transcribe assistant audio");
      return assistantAudioTranscription.transcribeDataUrl(input);
    },
  );
  safeHandle(ipcChannels.agents.reviewRun, reviewAgentRunSchema, async (_event, input) => {
    await assertAgentWorkspaceAccess(input, "review agent runs");
    return agentMutations.reviewRun(input);
  });
  safeHandle(
    ipcChannels.agents.sendAssistantMessage,
    sendAssistantChatTurnSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "send assistant messages");
      return agentMutations.sendAssistantMessage(await withTrustedAssistantActor(input));
    },
  );
  safeHandle(
    ipcChannels.agents.createDraftRunFromChat,
    createDraftRunFromChatSchema,
    async (_event, input) => {
      await assertAgentWorkspaceAccess(input, "create draft runs from chat");
      return agentMutations.createDraftRunFromChat(input);
    },
  );
  safeHandle(
    ipcChannels.app.reportRuntimeError,
    recordRuntimeErrorSchema,
    (_event, input) => runtimeDiagnostics.recordRuntimeError(input),
  );
  safeHandleReadWithSchema(
    ipcChannels.overview.getSnapshot,
    emptyReadArgsSchema,
    () => foundationReads.getOverviewSnapshot(),
    "The app could not load the overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.overview.getTimeline,
    scheduleTimelineReadArgsSchema,
    async (
      _event,
      range: ScheduleTimelineRange,
      scale: ScheduleTimelineScale,
      anchorDate?: string,
      query?: ScheduleTimelineQuery,
    ) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load schedule overview",
          accessLevel: "read",
          requiredPermission: "projects.read",
        });
      }

      return foundationReads.getScheduleTimeline(range, scale, anchorDate, query);
    },
    "The app could not load the schedule timeline.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getList,
    assetListReadArgsSchema,
    async (_event, query: AssetListQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load assets",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssets(query);
    },
    "The app could not load assets.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getSummary,
    assetWorkspaceReadArgsSchema,
    async (_event, query: AssetWorkspaceQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load the asset summary",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssetSummary(query);
    },
    "The app could not load the asset summary.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getOverview,
    assetWorkspaceReadArgsSchema,
    async (_event, query: AssetWorkspaceQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load the asset overview",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssetsOverview(query);
    },
    "The app could not load the asset overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getDetail,
    idReadArgsSchema,
    async (_event, assetId: string) => {
      await workspaceAccess.assertAssetAccess(assetId, "load that asset", "read", "assets.read");
      return foundationReads.getAssetDetail(assetId);
    },
    "The app could not load that asset.",
  );
  safeHandle(ipcChannels.assets.assignMove, assignMoveAssetsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "assign or move assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.assignMoveAssets(input);
  });
  safeHandle(ipcChannels.assets.create, createAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.createAsset(input);
  });
  safeHandle(ipcChannels.assets.update, updateAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.updateAsset(input);
  });
  safeHandle(ipcChannels.assets.archive, archiveAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "archive assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.archiveAsset(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.assets.uploadFiles,
    idReadArgsSchema,
    async (_event, assetId: string) => {
      await workspaceAccess.assertAssetAccess(assetId, "attach files to that asset", "write", "assets.manage");
      const detail = foundationReads.getAssetDetail(assetId);

      if (!detail.asset) {
        throw new Error("Asset was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach files to ${detail.asset.name}`,
        buttonLabel: "Attach files",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No asset files were selected.",
        };
      }

      return fileUploads.importAssetFiles(assetId, filePaths);
    },
    "The app could not attach files to that asset.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.uploadImages,
    idReadArgsSchema,
    async (_event, assetId: string) => {
      await workspaceAccess.assertAssetAccess(assetId, "attach images to that asset", "write", "assets.manage");
      const detail = foundationReads.getAssetDetail(assetId);

      if (!detail.asset) {
        throw new Error("Asset was not found.");
      }

      const currentImageCount = detail.files.filter(
        (file) => file.status === "available" && file.mimeType.startsWith("image/"),
      ).length;
      const remainingSlots = Math.max(0, 2 - currentImageCount);

      if (remainingSlots <= 0) {
        return {
          uploadedCount: 0,
          summary: "This asset already has the maximum of 2 images.",
        };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Add images to ${detail.asset.name}`,
        buttonLabel: remainingSlots === 1 ? "Add image" : "Add images",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No asset images were selected.",
        };
      }

      const selectedFilePaths = filePaths.slice(0, remainingSlots);
      const result = fileUploads.importAssetFiles(assetId, selectedFilePaths);

      if (filePaths.length > selectedFilePaths.length) {
        return {
          ...result,
          summary: `${result.summary} Only ${remainingSlots} image${remainingSlots === 1 ? "" : "s"} can be attached to this asset.`,
        };
      }

      return result;
    },
    "The app could not attach images to that asset.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.openFile,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertAssetFileAccess(fileId, "open that asset file", "read", "assets.read");
      await fileUploads.openAssetFile(fileId);
      return null;
    },
    "The app could not open that asset file.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.deleteFile,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertAssetFileAccess(fileId, "remove that asset file", "write", "assets.manage");
      return fileUploads.deleteAssetFile(fileId);
    },
    "The app could not remove that asset file.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.getList,
    packingSlipListReadArgsSchema,
    async (_event, query: PackingSlipListQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Workspace scope is required to load packing slips.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load packing slips",
        accessLevel: "read",
        requiredPermission: "packing-slips.read",
      });

      return foundationReads.getPackingSlips(query);
    },
    "The app could not load packing slips.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.getDetail,
    idReadArgsSchema,
    async (_event, packingSlipId: string) => {
      await workspaceAccess.assertPackingSlipAccess(packingSlipId, "load that packing slip", "read", "packing-slips.read");
      return foundationReads.getPackingSlipDetail(packingSlipId);
    },
    "The app could not load that packing slip.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.exportPdf,
    idReadArgsSchema,
    async (_event, packingSlipId: string) => {
      await workspaceAccess.assertPackingSlipAccess(packingSlipId, "export that packing slip", "read", "packing-slips.read");
      const detail = foundationReads.getPackingSlipDetail(packingSlipId);

      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export packing slip PDF",
        defaultPath: path.join(app.getPath("documents"), buildPackingSlipPdfFileName(detail.slip, "PS")),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Packing slip PDF export cancelled.",
        };
      }

      const pdf = await exportPackingSlipPdf(packingSlipId, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export that packing slip PDF.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.exportInsurancePdf,
    idReadArgsSchema,
    async (_event, packingSlipId: string) => {
      await workspaceAccess.assertPackingSlipAccess(packingSlipId, "export that insurance list", "read", "packing-slips.read");
      const detail = foundationReads.getPackingSlipDetail(packingSlipId);

      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export insurance list PDF",
        defaultPath: path.join(app.getPath("documents"), buildPackingSlipPdfFileName(detail.slip, "IL")),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Insurance list PDF export cancelled.",
        };
      }

      const pdf = await exportPackingSlipInsurancePdf(packingSlipId, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export that insurance list PDF.",
  );
  safeHandle(ipcChannels.packing.create, createPackingSlipSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create packing slips",
      accessLevel: "write",
      requiredPermission: "packing-slips.create",
    });

    return packingMutations.createPackingSlip(input);
  });
  safeHandle(ipcChannels.packing.returnItems, returnPackingSlipItemsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "return packing slip items",
      accessLevel: "write",
      requiredPermission: "packing-slips.create",
    });

    return packingMutations.returnPackingSlipItems(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.incidents.getList,
    incidentListReadArgsSchema,
    async (_event, query: IncidentListQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Workspace scope is required to load incidents.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load incidents",
        accessLevel: "read",
        requiredPermission: "incidents.read",
      });

      return foundationReads.getIncidents(query);
    },
    "The app could not load incidents.",
  );
  safeHandleReadWithSchema(
    ipcChannels.incidents.getDetail,
    idReadArgsSchema,
    async (_event, incidentId: string) => {
      await workspaceAccess.assertIncidentAccess(incidentId, "load that incident", "read", "incidents.read");
      return foundationReads.getIncidentDetail(incidentId);
    },
    "The app could not load that incident.",
  );
  safeHandle(ipcChannels.incidents.report, reportIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "report incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.reportIncident(input);
  });
  safeHandle(ipcChannels.incidents.update, updateIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.updateIncident(input);
  });
  safeHandle(ipcChannels.incidents.resolve, resolveIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "resolve incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.resolveIncident(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.incidents.uploadFiles,
    idReadArgsSchema,
    async (_event, incidentId: string) => {
      await workspaceAccess.assertIncidentAccess(incidentId, "attach files to that incident", "write", "incidents.create");
      const detail = foundationReads.getIncidentDetail(incidentId);

      if (!detail.incident) {
        throw new Error("Incident was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach evidence to ${detail.incident.title}`,
        buttonLabel: "Attach evidence",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No incident evidence files were selected.",
        };
      }

      return fileUploads.importIncidentFiles(incidentId, filePaths);
    },
    "The app could not attach files to that incident.",
  );
  safeHandleReadWithSchema(
    ipcChannels.incidents.openFile,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertIncidentFileAccess(fileId, "open that incident file", "read", "incidents.read");
      await fileUploads.openIncidentFile(fileId);
      return null;
    },
    "The app could not open that incident file.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getList,
    projectListReadArgsSchema,
    async (_event, query: ProjectListQuery | undefined) => {
      const scopedQuery = normalizeProjectListQuery(query);
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: scopedQuery.workspaceId ?? DEFAULT_WORKSPACE_ID,
        action: "load projects",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      return getProjectListForWorkspace(scopedQuery);
    },
    "The app could not load projects.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getDetail,
    idReadArgsSchema,
    async (_event, projectId: string) => {
      const workspaceId = await workspaceAccess.assertProjectAccess(projectId, "load that project", "read", "projects.read");
      const includeFinancials = await canReadFinanceForWorkspace(workspaceId);
      return foundationReads.getProjectDetail(projectId, { includeFinancials });
    },
    "The app could not load that project.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getDeletePreview,
    idReadArgsSchema,
    async (_event, projectId: string) => {
      await workspaceAccess.assertProjectAccess(projectId, "load that project lifecycle preview", "read", "projects.manage");
      return foundationReads.getProjectDeletePreview(projectId);
    },
    "The app could not load that project lifecycle preview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getCatalog,
    assetWorkspaceReadArgsSchema,
    async (_event, query: AssetWorkspaceQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Workspace scope is required to load the project catalog.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load the project catalog",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });

      return foundationReads.getCatalogSnapshot({ workspaceId: query.workspaceId });
    },
    "The app could not load the catalog.",
  );
  safeHandle(ipcChannels.projects.create, createProjectSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create projects",
      accessLevel: "write",
      requiredPermission: "projects.manage",
    });
    projectMutations.createProject(input);
    return getProjectListForWorkspace({ workspaceId: input.workspaceId, search: "", sortBy: "name", sortDirection: "asc" });
  });
  safeHandleReadWithSchema(
    ipcChannels.projects.getStagingPackingSlips,
    emptyReadArgsSchema,
    () => foundationReads.getStagingPackingSlips(),
    "The app could not load staging packing slips.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getCreationConflicts,
    createProjectBlueprintReadArgsSchema,
    async (_event, input: CreateProjectBlueprintInput) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "preview project setup",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      return foundationReads.getProjectCreationConflicts(input);
    },
    "The app could not preview project setup conflicts.",
  );
  safeHandle(ipcChannels.projects.createBlueprint, createProjectBlueprintSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create projects",
      accessLevel: "write",
      requiredPermission: "projects.manage",
    });
    projectMutations.createProjectBlueprint(input);
    return getProjectListForWorkspace({ workspaceId: input.workspaceId, search: "", sortBy: "name", sortDirection: "asc" });
  });
  safeHandleReadWithSchema(
    ipcChannels.projects.exportBlueprintPdf,
    createProjectBlueprintReadArgsSchema,
    async (_event, input: CreateProjectBlueprintInput) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "export project setup",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      const baseName = input.generalInfo.code?.trim() || input.generalInfo.name?.trim() || "project-setup-summary";
      const safeBaseName = baseName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "project-setup-summary";
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export project setup summary",
        defaultPath: path.join(app.getPath("documents"), `${safeBaseName}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Project setup summary export cancelled.",
        };
      }

      const pdf = await exportProjectBlueprintPdf(input, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export that project setup summary.",
  );
  safeHandle(ipcChannels.projects.update, updateProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "update that project", "write", "projects.manage");
    projectMutations.updateProject(input);
    return getProjectListForWorkspace({ workspaceId, search: "", sortBy: "name", sortDirection: "asc" });
  });
  safeHandle(ipcChannels.projects.archive, archiveProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "archive that project", "write", "projects.manage");
    projectMutations.archiveProject(input);
    return getProjectListForWorkspace({ workspaceId, search: "", sortBy: "name", sortDirection: "asc", includeArchived: true });
  });
  safeHandle(ipcChannels.projects.unarchive, unarchiveProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "restore that project", "write", "projects.manage");
    projectMutations.unarchiveProject(input);
    return getProjectListForWorkspace({ workspaceId, search: "", sortBy: "name", sortDirection: "asc", includeArchived: true });
  });
  safeHandle(ipcChannels.projects.delete, deleteProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "delete that project", "write", "projects.manage");
    projectMutations.deleteProject(input);
    return getProjectListForWorkspace({ workspaceId, search: "", sortBy: "name", sortDirection: "asc" });
  });
  safeHandle(ipcChannels.projects.createUnit, createProjectUnitSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "create project units", "write", "projects.manage");
    projectMutations.createProjectUnit(input);
    return getProjectDetailForWorkspace(workspaceId, input.projectId);
  });
  safeHandle(ipcChannels.projects.updateUnit, updateProjectUnitSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "update project units", "write", "projects.manage");
    projectMutations.updateProjectUnit(input);
    return getProjectDetailForWorkspace(workspaceId, input.projectId);
  });
  safeHandle(ipcChannels.projects.deleteUnit, deleteProjectUnitSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "delete project units", "write", "projects.manage");
    projectMutations.deleteProjectUnit(input);
    return getProjectDetailForWorkspace(workspaceId, input.projectId);
  });
  safeHandle(ipcChannels.projects.assignCrewToUnit, assignCrewToProjectUnitSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "assign crew to project units", "write", "projects.manage");
    projectMutations.assignCrewToProjectUnit(input);
    return getProjectDetailForWorkspace(workspaceId, input.projectId);
  });
  safeHandle(ipcChannels.projects.unassignCrewFromUnit, unassignCrewFromProjectUnitSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "remove crew from project units", "write", "projects.manage");
    projectMutations.unassignCrewFromProjectUnit(input);
    return getProjectDetailForWorkspace(workspaceId, input.projectId);
  });
  safeHandleReadWithSchema(
    ipcChannels.catalog.getSnapshot,
    catalogListReadArgsSchema,
    async (_event, query: CatalogListQuery | undefined) => {
      const workspaceId = query?.workspaceId ?? DEFAULT_WORKSPACE_ID;
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "view this catalog",
        accessLevel: "read",
      });
      return foundationReads.getCatalogSnapshot({ ...query, workspaceId });
    },
    "The app could not load the catalog snapshot.",
  );
  safeHandle(ipcChannels.catalog.create, createCatalogEntitySchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update this catalog",
      accessLevel: "write",
    });
    catalogMutations.createEntity(input);
    return foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId });
  });
  safeHandle(ipcChannels.catalog.update, updateCatalogEntitySchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update this catalog",
      accessLevel: "write",
    });
    catalogMutations.updateEntity(input);
    return foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId });
  });
  safeHandle(ipcChannels.catalog.delete, deleteCatalogEntitySchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update this catalog",
      accessLevel: "write",
    });
    catalogMutations.deleteEntity(input);
    return foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId });
  });
  safeHandle(ipcChannels.catalog.deleteMany, deleteCatalogEntitiesSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update this catalog",
      accessLevel: "write",
    });
    catalogMutations.deleteEntities(input);
    return foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId });
  });
  safeHandle(
    ipcChannels.catalog.exportCsv,
    exportCatalogCsvSchema,
    async (_event, input: ExportCatalogCsvInput) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "export this catalog",
        accessLevel: "read",
      });
      const exportPayload = catalogMutations.buildCsvExport(input);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Export ${input.entityType} CSV`,
        defaultPath: path.join(app.getPath("documents"), exportPayload.fileName),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "CSV export cancelled.",
        };
      }

      fs.writeFileSync(filePath, exportPayload.csvText, "utf8");

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${exportPayload.fileName} to ${path.basename(filePath)}.`,
      };
    },
  );
  safeHandle(ipcChannels.catalog.previewImportCsv, previewCatalogCsvImportSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "import this catalog",
      accessLevel: "write",
    });
    return catalogMutations.previewCsvImport(input);
  });
  safeHandle(ipcChannels.catalog.importCsv, importCatalogCsvSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "import this catalog",
      accessLevel: "write",
    });
    const result = catalogMutations.importCsv(input);
    return {
      result,
      snapshot: foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId }),
    };
  });
  safeHandleReadWithSchema(
    ipcChannels.catalog.uploadCrewDocuments,
    uploadCrewCatalogDocumentsReadArgsSchema,
    async (_event, input: { workspaceId: string; crewMemberId: string; sourceFilePaths?: string[] }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "attach crew documents",
        accessLevel: "write",
      });
      const crewMemberId = input.crewMemberId;
      const crewMember = foundationReads
        .getCatalogSnapshot({
          workspaceId: input.workspaceId,
          entityType: "crew",
          search: "",
          sortBy: "fullName",
          sortDirection: "asc",
        })
        .crewMembers.find((row) => row.id === crewMemberId);

      if (!crewMember) {
        throw new Error("Crew member was not found.");
      }

      const resolvedPaths =
        input.sourceFilePaths && input.sourceFilePaths.length
          ? input.sourceFilePaths
          : (() => null)();

      if (resolvedPaths) {
        return fileUploads.importCrewDocuments(crewMemberId, resolvedPaths);
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach crew documents to ${crewMember.fullName}`,
        buttonLabel: "Attach documents",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No crew documents were selected.",
        };
      }

      return fileUploads.importCrewDocuments(crewMemberId, filePaths);
    },
    "The app could not attach documents to that crew member.",
  );
  safeHandleReadWithSchema(
    ipcChannels.catalog.openCrewDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertCrewDocumentAccess(fileId, "open that crew document", "read");
      await fileUploads.openCrewDocument(fileId);
      return null;
    },
    "The app could not open that crew document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.catalog.deleteCrewDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertCrewDocumentAccess(fileId, "remove that crew document", "write");
      return fileUploads.deleteCrewDocument(fileId);
    },
    "The app could not remove that crew document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.rma.getSnapshot,
    rmaSnapshotReadArgsSchema,
    async (_event, query: RmaSnapshotQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Select a workspace before loading RMAs.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load RMAs",
        accessLevel: "read",
        requiredPermission: "rma.read",
      });

      return foundationReads.getRmaSnapshot(query);
    },
    "The app could not load the RMA snapshot.",
  );
  safeHandleReadWithSchema(
    ipcChannels.rma.getDetail,
    idReadArgsSchema,
    async (_event, rmaCaseId: string) => {
      await workspaceAccess.assertRmaCaseAccess(rmaCaseId, "load that RMA case", "read", "rma.read");
      return foundationReads.getRmaCaseDetail(rmaCaseId);
    },
    "The app could not load that RMA case.",
  );
  safeHandle(ipcChannels.rma.create, createRmaCaseSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create RMAs",
      accessLevel: "write",
      requiredPermission: "rma.create",
    });
    return rmaMutations.createRmaCase(input);
  });
  safeHandle(ipcChannels.rma.update, updateRmaCaseSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertRmaCaseAccess(input.rmaCaseId, "update that RMA case", "write", "rma.create");
    if (workspaceId !== input.workspaceId) {
      throw new Error("That RMA case belongs to another workspace.");
    }

    return rmaMutations.updateRmaCase(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.finance.getOverview,
    financeOverviewReadArgsSchema,
    async (_event, query: FinanceOverviewQuery | undefined) => {
      const workspaceId = requireWorkspaceId(query, "load finance overview");
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "load finance overview",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return foundationReads.getFinanceOverview(query);
    },
    "The app could not load finance overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getDocuments,
    idReadArgsSchema,
    async (_event, entryId: string) => {
      await workspaceAccess.assertFinanceEntryAccess(entryId, "load finance documents", "read", "finance.read");
      return foundationReads.getFinanceEntryDocuments(entryId);
    },
    "The app could not load finance documents.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.uploadDocuments,
    idReadArgsSchema,
    async (_event, entryId: string) => {
      const workspaceId = await workspaceAccess.assertFinanceEntryAccess(
        entryId,
        "attach finance documents",
        "write",
        "finance.read",
      );
      const entry = foundationReads.getFinanceEntries({
        workspaceId,
        search: "",
        sortBy: "date",
        sortDirection: "desc",
      }).find((row) => row.id === entryId);

      if (!entry) {
        throw new Error("Finance entry was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach documents to ${entry.reference}`,
        buttonLabel: "Attach documents",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No finance documents were selected.",
        };
      }

      return fileUploads.importFinanceDocuments(entryId, filePaths);
    },
    "The app could not attach documents to that finance entry.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.openDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertFinanceDocumentAccess(fileId, "open that finance document", "read", "finance.read");
      await fileUploads.openFinanceDocument(fileId);
      return null;
    },
    "The app could not open that finance document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.exportReportPdf,
    financeOverviewReadArgsSchema,
    async (_event, query: FinanceOverviewQuery | undefined) => {
      const workspaceId = requireWorkspaceId(query, "export finance report");
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "export finance report",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      const dateStamp = new Date().toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export finance report PDF",
        defaultPath: path.join(app.getPath("documents"), `finance-report-${dateStamp}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Finance report PDF export cancelled.",
        };
      }

      const pdf = await exportFinanceReportPdf(query, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export the finance report PDF.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getCostLinks,
    workspaceQueryReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load finance cost links",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return foundationReads.getFinanceCostLinks(query.workspaceId);
    },
    "The app could not load finance cost links.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getEntries,
    financeEntryListReadArgsSchema,
    async (_event, query: FinanceEntryListQuery | undefined) => {
      const workspaceId = requireWorkspaceId(query, "load finance entries");
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "load finance entries",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return foundationReads.getFinanceEntries(query);
    },
    "The app could not load finance entries.",
  );
  safeHandle(ipcChannels.finance.create, createFinancialEntrySchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create finance entries",
      accessLevel: "write",
      requiredPermission: "finance.manage",
    });
    return financeMutations.createEntry(input);
  });
  safeHandle(ipcChannels.finance.update, updateFinancialEntrySchema, async (_event, input) => {
    await workspaceAccess.assertFinanceEntryAccess(input.entryId, "update finance entries", "write", "finance.manage");
    return financeMutations.updateEntry(input);
  });

  safeHandleReadWithSchema(
    ipcChannels.finance.listCollaboratorFees,
    collaboratorFeeListReadArgsSchema,
    async (_event, query: CollaboratorFeeListQuery | undefined) => {
      const workspaceId = requireWorkspaceId(query, "load collaborator fees");
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId,
        action: "load collaborator fees",
        accessLevel: "read",
        requiredPermission: "crew_fees.read",
      });
      return collaboratorFeeReads.listFees(query);
    },
    "The app could not load collaborator fees.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getCollaboratorFeeDetail,
    collaboratorFeeDetailReadArgsSchema,
    async (_event, query: { workspaceId: string; feeId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load collaborator fee detail",
        accessLevel: "read",
        requiredPermission: "crew_fees.read",
      });
      return collaboratorFeeReads.getFeeDetail(query.workspaceId, query.feeId);
    },
    "The app could not load collaborator fee detail.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getCollaboratorFeeSummary,
    collaboratorFeeSummaryReadArgsSchema,
    async (_event, query: { workspaceId: string; projectId?: string | null }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load collaborator payment summary",
        accessLevel: "read",
        requiredPermission: "crew_fees.read",
      });
      return collaboratorFeeReads.getSummary(query);
    },
    "The app could not load collaborator payment summary.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.suggestCollaboratorFees,
    collaboratorFeeSuggestionsReadArgsSchema,
    async (_event, query: { workspaceId: string; projectId?: string | null; crewMemberId?: string | null }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "suggest collaborator fees",
        accessLevel: "read",
        requiredPermission: "crew_fees.manage",
      });
      return collaboratorFeeReads.suggestFromAssignments(query);
    },
    "The app could not suggest collaborator fees.",
  );
  safeHandle(ipcChannels.finance.createCollaboratorFee, createCollaboratorFeeSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create collaborator fees",
      accessLevel: "write",
      requiredPermission: "crew_fees.manage",
    });
    return collaboratorFeeMutations.createFee(input);
  });
  safeHandle(ipcChannels.finance.updateCollaboratorFee, updateCollaboratorFeeSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update collaborator fees",
      accessLevel: "write",
      requiredPermission: "crew_fees.manage",
    });
    return collaboratorFeeMutations.updateFee(input);
  });
  safeHandle(ipcChannels.finance.approveCollaboratorFee, approveCollaboratorFeeSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "approve collaborator fees",
      accessLevel: "write",
      requiredPermission: "crew_fees.manage",
    });
    return collaboratorFeeMutations.approveFee(input);
  });
  safeHandle(ipcChannels.finance.cancelCollaboratorFee, cancelCollaboratorFeeSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "cancel collaborator fees",
      accessLevel: "write",
      requiredPermission: "crew_fees.manage",
    });
    return collaboratorFeeMutations.cancelFee(input);
  });
  safeHandle(ipcChannels.finance.recordCollaboratorPayment, recordCollaboratorPaymentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "record collaborator payments",
      accessLevel: "write",
      requiredPermission: "crew_payments.record",
    });
    return collaboratorFeeMutations.recordPayment(input);
  });

  safeHandleReadWithSchema(
    ipcChannels.currency.getSettings,
    currencySettingsReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load currency settings",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return currencyReads.getSettings(query.workspaceId);
    },
    "The app could not load currency settings.",
  );
  safeHandleReadWithSchema(
    ipcChannels.currency.listRates,
    exchangeRateListReadArgsSchema,
    async (
      _event,
      query: { workspaceId: string; baseCurrency?: string; quoteCurrency?: string; limit?: number },
    ) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load exchange rates",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      const { workspaceId, ...filter } = query;
      return currencyReads.listRates(workspaceId, filter);
    },
    "The app could not load exchange rates.",
  );
  safeHandleReadWithSchema(
    ipcChannels.currency.getLatestRate,
    latestExchangeRateReadArgsSchema,
    async (
      _event,
      query: {
        workspaceId: string;
        baseCurrency: string;
        quoteCurrency: string;
        rateType?: import("@contracts").CurrencyRateType;
      },
    ) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load exchange rates",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return currencyReads.getLatestRate(query.workspaceId, query.baseCurrency, query.quoteCurrency, query.rateType);
    },
    "The app could not load the latest exchange rate.",
  );
  safeHandle(ipcChannels.currency.upsertSettings, upsertCurrencySettingsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update currency settings",
      accessLevel: "write",
      requiredPermission: "currency.manage_rates",
    });
    return currencyMutations.upsertSettings(input);
  });
  safeHandle(ipcChannels.currency.createRate, createExchangeRateSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create exchange rates",
      accessLevel: "write",
      requiredPermission: "currency.manage_rates",
    });
    return currencyMutations.createRate(input);
  });
  safeHandle(ipcChannels.currency.deleteRate, deleteExchangeRateSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "delete exchange rates",
      accessLevel: "write",
      requiredPermission: "currency.manage_rates",
    });
    return currencyMutations.deleteRate(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.currency.getProviderStatus,
    currencyRateProviderStatusReadArgsSchema,
    async (_event, query: { workspaceId: string; provider: import("@contracts").CurrencyRateProviderKey }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load exchange-rate provider",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return currencyRateProviders.getStatus(query.workspaceId);
    },
    "The app could not load exchange-rate provider status.",
  );
  safeHandle(
    ipcChannels.currency.saveProviderConfig,
    saveCurrencyRateProviderConfigSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "update exchange-rate provider",
        accessLevel: "write",
        requiredPermission: "currency.manage_rates",
      });
      return currencyRateProviders.saveConfig(input);
    },
  );
  safeHandle(ipcChannels.currency.refreshRates, refreshCurrencyRatesSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "refresh exchange rates",
      accessLevel: "write",
      requiredPermission: "currency.manage_rates",
    });
    return currencyRateProviders.refreshRates(input);
  });

  safeHandleReadWithSchema(
    ipcChannels.quotes.list,
    quoteListReadArgsSchema,
    async (_event, filter: import("@contracts").QuoteListFilter) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: filter.workspaceId,
        action: "load quotes",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return quoteReads.listQuotes(filter);
    },
    "The app could not load quotes.",
  );
  safeHandleReadWithSchema(
    ipcChannels.quotes.detail,
    quoteDetailReadArgsSchema,
    async (_event, query: { workspaceId: string; quoteId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load quote detail",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return quoteReads.getQuoteDetail(query.workspaceId, query.quoteId);
    },
    "The app could not load the quote detail.",
  );
  safeHandle(ipcChannels.quotes.create, createQuoteSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create quotes",
      accessLevel: "write",
      requiredPermission: "quotes.create",
    });
    return quoteMutations.createQuote(input);
  });
  safeHandle(ipcChannels.quotes.update, updateQuoteSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update quotes",
      accessLevel: "write",
      requiredPermission: "quotes.edit",
    });
    return quoteMutations.updateQuote(input);
  });
  safeHandle(ipcChannels.quotes.setStatus, setQuoteStatusSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update quote status",
      accessLevel: "write",
      requiredPermission: "quotes.edit",
    });
    return quoteMutations.setStatus(input);
  });
  safeHandle(ipcChannels.quotes.duplicate, duplicateQuoteSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "duplicate quotes",
      accessLevel: "write",
      requiredPermission: "quotes.create",
    });
    return quoteMutations.duplicateQuote(input);
  });
  safeHandle(ipcChannels.quotes.delete, duplicateQuoteSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "delete quotes",
      accessLevel: "write",
      requiredPermission: "quotes.cancel",
    });
    return quoteMutations.deleteQuote(input);
  });
  safeHandle(ipcChannels.quotes.renumber, renumberQuoteSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "renumber quote",
      accessLevel: "write",
      requiredPermission: "quotes.edit",
    });
    return quoteMutations.renumberQuote(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.quotes.listVersions,
    quoteVersionsReadArgsSchema,
    async (_event, query: { workspaceId: string; quoteId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load quote versions",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      return quoteReads.listQuoteVersions(query.workspaceId, query.quoteId);
    },
    "The app could not load quote versions.",
  );
  safeHandle(ipcChannels.quotes.restoreVersion, restoreQuoteFromVersionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "restore quote version",
      accessLevel: "write",
      requiredPermission: "quotes.edit",
    });
    return quoteMutations.restoreQuoteFromVersion(input);
  });

  // -- Invoices ----------------------------------------------------------------
  safeHandleReadWithSchema(
    ipcChannels.invoices.list,
    invoiceListReadArgsSchema,
    async (_event, filter: import("@contracts").InvoiceListFilter) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: filter.workspaceId,
        action: "load invoices",
        accessLevel: "read",
        requiredPermission: "invoices.read",
      });
      return invoiceReads.listInvoices(filter);
    },
    "The app could not load invoices.",
  );
  safeHandleReadWithSchema(
    ipcChannels.invoices.detail,
    invoiceDetailReadArgsSchema,
    async (_event, query: { workspaceId: string; invoiceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load invoice detail",
        accessLevel: "read",
        requiredPermission: "invoices.read",
      });
      return invoiceReads.getInvoiceDetail(query.workspaceId, query.invoiceId);
    },
    "The app could not load the invoice detail.",
  );
  safeHandleReadWithSchema(
    ipcChannels.invoices.exportPdf,
    invoiceDetailReadArgsSchema,
    async (_event, query: { workspaceId: string; invoiceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "export invoice PDF",
        accessLevel: "read",
        requiredPermission: "invoices.export",
      });
      const detail = invoiceReads.getInvoiceDetail(query.workspaceId, query.invoiceId);
      if (!detail) {
        throw new Error("Invoice was not found.");
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      const safeNumber = detail.invoiceNumber.replace(/[^a-z0-9_-]+/gi, "_");
      const safeClient = detail.clientNameSnapshot.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export invoice PDF",
        defaultPath: path.join(app.getPath("documents"), `Factura_${safeNumber}_${safeClient}_${dateStamp}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Invoice PDF export cancelled.",
        };
      }

      const pdf = await exportInvoicePdf(query.workspaceId, query.invoiceId);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export the invoice PDF.",
  );
  safeHandle(ipcChannels.invoices.create, createInvoiceSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create invoice",
      accessLevel: "write",
      requiredPermission: "invoices.create",
    });
    return invoiceMutations.createInvoice(input);
  });
  safeHandle(ipcChannels.invoices.update, updateInvoiceSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update invoice",
      accessLevel: "write",
      requiredPermission: "invoices.edit_draft",
    });
    return invoiceMutations.updateInvoice(input);
  });
  safeHandle(ipcChannels.invoices.issue, issueInvoiceSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "issue invoice",
      accessLevel: "write",
      requiredPermission: "invoices.issue",
    });
    return invoiceMutations.issueInvoice(input);
  });
  safeHandle(ipcChannels.invoices.cancel, cancelInvoiceSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "cancel invoice",
      accessLevel: "write",
      requiredPermission: "invoices.cancel",
    });
    return invoiceMutations.cancelInvoice(input);
  });
  safeHandle(ipcChannels.invoices.recordPayment, recordInvoicePaymentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "record invoice payment",
      accessLevel: "write",
      requiredPermission: "invoices.record_payment",
    });
    return invoiceMutations.recordInvoicePayment(input);
  });
  safeHandle(ipcChannels.invoices.renumber, renumberInvoiceSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "renumber invoice",
      accessLevel: "write",
      requiredPermission: "invoices.edit_draft",
    });
    return invoiceMutations.renumberInvoice(input);
  });
  // `createFromQuote` is a convenience: the renderer passes the quote id +
  // a fresh command id, and the main process snapshots the live quote into
  // a brand-new invoice draft. Validation happens server-side: only quotes
  // currently in `approved` status can seed an invoice.
  safeHandle(
    ipcChannels.invoices.createFromQuote,
    createInvoiceFromQuoteSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "generate invoice from quote",
        accessLevel: "write",
        requiredPermission: "invoices.create",
      });
      const quote = quoteReads.getQuoteDetail(input.workspaceId, input.quoteId);
      if (!quote) {
        throw new Error("Quote not found.");
      }
      if (quote.status !== "approved") {
        throw new Error(`Only approved quotes can seed an invoice (current status: ${quote.status}).`);
      }
      return invoiceMutations.createInvoiceFromQuote(quote, {
        commandId: input.commandId,
        actorType: "user",
        sourceChannel: "desktop",
      });
    },
  );

  // -------------------------------------------------------------------------
  // Treasury (PILAR T) — bank reconciliation
  // -------------------------------------------------------------------------
  safeHandleReadWithSchema(
    ipcChannels.treasury.listAccounts,
    treasuryAccountsReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load bank accounts",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getAccounts(query.workspaceId);
    },
    "The app could not load bank accounts.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.listTransactions,
    treasuryTransactionListReadArgsSchema,
    async (_event, query: import("@contracts").TreasuryTransactionListQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId ?? "",
        action: "load treasury transactions",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.listTransactions(query);
    },
    "The app could not load transactions.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.previewClassificationRule,
    counterpartyRulePreviewReadArgsSchema,
    async (_event, query: import("@contracts").CounterpartyRulePreviewQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "preview classification rule",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.previewClassificationRule(query);
    },
    "The app could not preview the classification rule.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.listImports,
    treasuryImportsReadArgsSchema,
    async (_event, query: { workspaceId: string; bankAccountId?: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load imports",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.listImports(query.workspaceId, query.bankAccountId);
    },
    "The app could not load import history.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.overview,
    treasuryOverviewReadArgsSchema,
    async (_event, query: import("@contracts").TreasuryOverviewQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId ?? "",
        action: "load treasury overview",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getOverview(query);
    },
    "The app could not load the treasury overview.",
  );
  safeHandle(ipcChannels.treasury.exportOverviewPdf, treasuryOverviewQuerySchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId ?? "",
      action: "export treasury overview",
      accessLevel: "read",
      requiredPermission: "treasury.transactions.read",
    });
    const overview = treasuryReads.getOverview(input);
    const periodSlug = overview.activePeriodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "summary";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Export treasury overview",
      defaultPath: path.join(app.getPath("documents"), `treasury-overview-${periodSlug}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) {
      return {
        saved: false,
        fileName: null,
        savedPath: null,
        summary: "Treasury overview export cancelled.",
      };
    }

    const pdf = await exportTreasuryOverviewPdf(input, filePath);
    fs.writeFileSync(filePath, pdf.buffer);
    return {
      saved: true,
      fileName: path.basename(filePath),
      savedPath: filePath,
      summary: `Exported treasury overview for ${overview.activePeriodLabel}.`,
    };
  });
  safeHandleReadWithSchema(
    ipcChannels.treasury.reviewQueue,
    treasuryReviewQueueReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load review queue",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getReviewQueue(query.workspaceId);
    },
    "The app could not load the review queue.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.projectPnl,
    treasuryProjectPnlReadArgsSchema,
    async (_event, query: { workspaceId: string; dateFrom?: string; dateTo?: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load project P&L",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getProjectPnl(query.workspaceId, query.dateFrom, query.dateTo);
    },
    "The app could not load project P&L.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.listExpenseCategories,
    treasuryExpenseCategoriesReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load expense categories",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.listExpenseCategories(query.workspaceId);
    },
    "The app could not load expense categories.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.undoPreview,
    treasuryUndoPreviewReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "preview treasury undo",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getUndoPreview(query.workspaceId);
    },
    "The app could not load the treasury undo preview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.deductibleLedger,
    treasuryDeductibleLedgerReadArgsSchema,
    async (_event, query: import("@contracts").TreasuryDeductibleLedgerQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load deductible expense ledger",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getDeductibleLedger(query);
    },
    "The app could not load the deductible ledger.",
  );
  safeHandleReadWithSchema(
    ipcChannels.treasury.reimbursements,
    treasuryReimbursementsReadArgsSchema,
    async (_event, query: import("@contracts").TreasuryReimbursementsQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load treasury reimbursements",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getReimbursements(query);
    },
    "The app could not load treasury reimbursements.",
  );
  safeHandle(ipcChannels.treasury.exportDeductibleLedger, treasuryDeductibleLedgerExportSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "export deductible expense ledger",
      accessLevel: "read",
      requiredPermission: "treasury.transactions.read",
    });
    const ledger = treasuryReads.getDeductibleLedger(input);
    const baseName = buildDeductibleLedgerFileBaseName(ledger);
    const extension = input.format === "xlsx" ? "xlsx" : input.format === "pdf" ? "pdf" : "csv";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Export deductible expense ledger",
      defaultPath: path.join(app.getPath("documents"), `${baseName}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });

    if (canceled || !filePath) {
      return {
        saved: false,
        fileName: null,
        savedPath: null,
        summary: "Deductible ledger export cancelled.",
      };
    }

    if (input.format === "xlsx") {
      fs.writeFileSync(filePath, buildDeductibleLedgerXlsx(ledger));
    } else if (input.format === "pdf") {
      fs.writeFileSync(filePath, await createDeductibleLedgerPdf(ledger));
    } else {
      fs.writeFileSync(filePath, buildDeductibleLedgerCsv(ledger), "utf8");
    }

    return {
      saved: true,
      fileName: path.basename(filePath),
      savedPath: filePath,
      summary: `Exported ${ledger.rows.length} deductible ledger rows.`,
    };
  });
  safeHandleReadWithSchema(
    ipcChannels.treasury.dgiiReport,
    dgiiReportReadArgsSchema,
    async (_event, query: import("@contracts").DgiiReportQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load DGII fiscal report",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return treasuryReads.getDgiiReport(query);
    },
    "The app could not load the DGII report.",
  );
  safeHandle(ipcChannels.treasury.exportDgiiReport, dgiiReportExportSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "export DGII fiscal report",
      accessLevel: "read",
      requiredPermission: "treasury.transactions.read",
    });
    const report = treasuryReads.getDgiiReport(input);
    const baseName = buildDgiiReportFileBaseName(report);
    const extension = input.format === "xlsx" ? "xlsx" : input.format === "pdf" ? "pdf" : "csv";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Export ${report.title}`,
      defaultPath: path.join(app.getPath("documents"), `${baseName}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });

    if (canceled || !filePath) {
      return { saved: false, fileName: null, savedPath: null, summary: "DGII report export cancelled." };
    }

    if (input.format === "xlsx") {
      fs.writeFileSync(filePath, buildDgiiReportXlsx(report));
    } else if (input.format === "pdf") {
      fs.writeFileSync(filePath, await createDgiiReportPdf(report));
    } else {
      fs.writeFileSync(filePath, buildDgiiReportCsv(report), "utf8");
    }

    return {
      saved: true,
      fileName: path.basename(filePath),
      savedPath: filePath,
      summary: `Exported ${report.rowCount} ${report.kind} rows.`,
    };
  });
  safeHandle(ipcChannels.treasury.upsertAccount, upsertBankAccountSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "save bank account",
      accessLevel: "write",
      requiredPermission: "treasury.accounts.manage",
    });
    return treasuryMutations.upsertBankAccount(input);
  });
  safeHandle(ipcChannels.treasury.paymentInstrumentUpsert, upsertPaymentInstrumentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "save payment instrument",
      accessLevel: "write",
      requiredPermission: "treasury.accounts.manage",
    });
    return treasuryMutations.upsertBankAccount(input);
  });
  safeHandle(
    ipcChannels.treasury.paymentInstrumentDeactivate,
    deactivatePaymentInstrumentSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "deactivate payment instrument",
        accessLevel: "write",
        requiredPermission: "treasury.accounts.manage",
      });
      return treasuryMutations.deactivatePaymentInstrument(input);
    },
  );
  safeHandle(ipcChannels.treasury.importStatement, importStatementSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "import statement",
      accessLevel: "write",
      requiredPermission: "treasury.import",
    });
    return treasuryMutations.importStatement(input);
  });
  safeHandle(
    ipcChannels.treasury.addManualTransactions,
    addManualTransactionsSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "add manual transactions",
        accessLevel: "write",
        requiredPermission: "treasury.import",
      });
      return treasuryMutations.addManualTransactions(input);
    },
  );
  safeHandle(ipcChannels.treasury.deleteImport, deleteImportSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "delete import",
      accessLevel: "write",
      requiredPermission: "treasury.import",
    });
    return treasuryMutations.deleteImport(input);
  });
  safeHandle(ipcChannels.treasury.correctTransaction, correctTransactionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "correct treasury transaction",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.correctTransaction(input);
  });
  safeHandle(
    ipcChannels.treasury.annotateTransaction,
    annotateTransactionSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "classify transaction",
        accessLevel: "write",
        requiredPermission: "treasury.transactions.classify",
      });
      return treasuryMutations.annotateTransaction(input);
    },
  );
  safeHandle(
    ipcChannels.treasury.applyClassificationRule,
    applyCounterpartyRuleSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "apply classification rule",
        accessLevel: "write",
        requiredPermission: "treasury.transactions.classify",
      });
      return treasuryMutations.applyCounterpartyRule(input);
    },
  );
  safeHandle(ipcChannels.treasury.setAllocations, setAllocationsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "set allocations",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.setAllocations(input);
  });
  safeHandle(
    ipcChannels.treasury.reviewReimbursement,
    reviewReimbursementSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "review reimbursement",
        accessLevel: "write",
        requiredPermission: "treasury.reimbursements.review",
      });
      return treasuryMutations.reviewReimbursement(input);
    },
  );
  safeHandle(ipcChannels.treasury.linkTransaction, linkTransactionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "link transaction",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.linkTransaction(input);
  });
  safeHandle(
    ipcChannels.treasury.invoiceAllocationAssign,
    assignInvoiceAllocationSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "assign invoice allocation",
        accessLevel: "write",
        requiredPermission: "treasury.transactions.classify",
      });
      return treasuryMutations.assignInvoiceAllocation(input);
    },
  );
  safeHandle(
    ipcChannels.treasury.invoiceAllocationLinkToTransaction,
    linkInvoiceAllocationToTransactionSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "link invoice allocation",
        accessLevel: "write",
        requiredPermission: "treasury.transactions.classify",
      });
      return treasuryMutations.linkInvoiceAllocationToTransaction(input);
    },
  );
  safeHandle(ipcChannels.treasury.invoiceAllocationUnlink, unlinkInvoiceAllocationSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "unlink invoice allocation",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.unlinkInvoiceAllocation(input);
  });
  safeHandle(ipcChannels.treasury.invoiceAllocationReject, rejectInvoiceAllocationSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "reject invoice allocation",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.rejectInvoiceAllocation(input);
  });
  safeHandle(
    ipcChannels.treasury.invoiceAllocationMarkReimbursed,
    markInvoiceAllocationReimbursedSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "mark invoice allocation reimbursed",
        accessLevel: "write",
        requiredPermission: "treasury.reimbursements.review",
      });
      return treasuryMutations.markInvoiceAllocationReimbursed(input);
    },
  );
  safeHandle(ipcChannels.treasury.cardSettlementCreate, createCardSettlementSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create card settlement",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.createCardSettlement(input);
  });
  safeHandle(ipcChannels.treasury.undoLastAction, undoTreasuryActionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "undo treasury action",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return treasuryMutations.undoLastAction(input);
  });
  safeHandle(ipcChannels.treasury.invoiceInboxEnqueue, enqueueInvoiceBatchSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "enqueue invoice batch",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return invoiceInbox.enqueue(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.treasury.invoiceInboxList,
    invoiceInboxListReadArgsSchema,
    async (_event, query: import("@contracts").InvoiceInboxListQuery) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load invoice inbox",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return invoiceInbox.list(query);
    },
    "The app could not load the invoice inbox.",
  );
  safeHandle(ipcChannels.treasury.invoiceInboxUpdate, updateInvoiceExtractionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update invoice extraction",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return invoiceInbox.update(input);
  });
  safeHandle(ipcChannels.treasury.invoiceInboxBulkLink, bulkLinkInvoiceExtractionsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "bulk link invoice extractions",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return invoiceInbox.bulkLink(input);
  });
  safeHandle(ipcChannels.treasury.invoiceInboxRetry, retryInvoiceExtractionsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "retry invoice extraction",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return invoiceInbox.retry(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.treasury.invoiceInboxPreview,
    invoiceInboxPreviewReadArgsSchema,
    async (_event, query: { workspaceId: string; extractionId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "preview invoice document",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      const file = await invoiceInbox.getFileBuffer(query.extractionId);
      if (!file) return null;
      return {
        fileName: file.fileName,
        mimeType: file.mimeType,
        dataUrl: `data:${file.mimeType};base64,${file.buffer.toString("base64")}`,
      };
    },
    "The app could not load the invoice document.",
  );
  safeHandle(ipcChannels.treasury.invoiceInboxDownload, downloadInvoiceExtractionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "download invoice document",
      accessLevel: "read",
      requiredPermission: "treasury.transactions.read",
    });
    const doc = await invoiceInbox.getDownload(input.workspaceId, input.extractionId);
    if (!doc) {
      return { saved: false, fileName: null, savedPath: null, summary: "El documento ya no está disponible." };
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Descargar factura",
      defaultPath: path.join(app.getPath("downloads"), doc.fileName),
    });
    if (canceled || !filePath) {
      return { saved: false, fileName: null, savedPath: null, summary: "Descarga cancelada." };
    }
    fs.writeFileSync(filePath, doc.buffer);
    return {
      saved: true,
      fileName: path.basename(filePath),
      savedPath: filePath,
      summary: "Factura descargada.",
    };
  });
  safeHandle(
    ipcChannels.treasury.invoiceInboxDownloadBatch,
    downloadInvoiceExtractionBatchSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "download invoice documents",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      const bundle = await invoiceInbox.buildBatchZip(input.workspaceId, input.extractionIds);
      if (!bundle) {
        return { saved: false, fileName: null, savedPath: null, summary: "No hay documentos disponibles para descargar." };
      }
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Descargar facturas",
        defaultPath: path.join(app.getPath("downloads"), bundle.fileName),
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (canceled || !filePath) {
        return { saved: false, fileName: null, savedPath: null, summary: "Descarga cancelada." };
      }
      fs.writeFileSync(filePath, bundle.buffer);
      const missingNote = bundle.missingCount > 0 ? ` (${bundle.missingCount} no disponible(s))` : "";
      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `${bundle.includedCount} factura(s) descargada(s) en ZIP${missingNote}.`,
      };
    },
  );
  safeHandle(ipcChannels.treasury.invoiceInboxApply, applyInvoiceExtractionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "apply invoice extraction",
      accessLevel: "write",
      requiredPermission: "treasury.reimbursements.review",
    });
    return invoiceInbox.apply(input);
  });
  safeHandle(ipcChannels.treasury.invoiceInboxDismiss, dismissInvoiceExtractionSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "dismiss invoice extraction",
      accessLevel: "write",
      requiredPermission: "treasury.transactions.classify",
    });
    return invoiceInbox.dismiss(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.treasury.invoiceInboxDuplicates,
    invoiceInboxDuplicatesReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load invoice duplicates",
        accessLevel: "read",
        requiredPermission: "treasury.transactions.read",
      });
      return invoiceInbox.findDuplicateGroups(query.workspaceId);
    },
    "The app could not load invoice duplicates.",
  );
  safeHandle(ipcChannels.treasury.invoiceInboxBackfillHashes, backfillInvoiceHashesSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "backfill invoice hashes",
      accessLevel: "read",
      requiredPermission: "treasury.transactions.read",
    });
    return invoiceInbox.backfillContentHashes(input.workspaceId);
  });

  // Software licenses (local-first) ----------------------------------------
  safeHandleReadWithSchema(
    ipcChannels.licenses.list,
    softwareLicensesReadArgsSchema,
    async (_event, query: { workspaceId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load licenses",
        accessLevel: "read",
        requiredPermission: "assets.read",
      });
      return softwareLicenses.listLicenses(query.workspaceId);
    },
    "The app could not load licenses.",
  );
  safeHandle(ipcChannels.licenses.upsert, upsertSoftwareLicenseSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "save license",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });
    return softwareLicenses.upsertLicense(input);
  });
  safeHandle(ipcChannels.licenses.archive, archiveSoftwareLicenseSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "archive license",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });
    return softwareLicenses.archiveLicense(input);
  });
  safeHandle(ipcChannels.licenses.setSeats, setLicenseSeatsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update license seats",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });
    return softwareLicenses.setSeats(input);
  });

  safeHandleReadWithSchema(
    ipcChannels.quotes.exportPdf,
    quoteExportPdfReadArgsSchema,
    async (_event, query: { workspaceId: string; quoteId: string }) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "export quote PDF",
        accessLevel: "read",
        requiredPermission: "finance.read",
      });
      const detail = quoteReads.getQuoteDetail(query.workspaceId, query.quoteId);
      if (!detail) {
        throw new Error("Quote was not found.");
      }
      const dateStamp = new Date().toISOString().slice(0, 10);
      const safeNumber = detail.quoteNumber.replace(/[^a-z0-9_-]+/gi, "_");
      const safeClient = (detail.clientNameSnapshot || detail.attentionName || "cliente").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export quote PDF",
        defaultPath: path.join(app.getPath("documents"), `Cotizacion_${safeNumber}_${safeClient}_${dateStamp}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Quote PDF export cancelled.",
        };
      }
      const pdf = await exportQuotePdf(query.workspaceId, query.quoteId);
      fs.writeFileSync(filePath, pdf.buffer);
      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export the quote PDF.",
  );
};
