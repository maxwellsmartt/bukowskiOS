import { contextBridge, ipcRenderer } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";
import type {
  AIProviderMutationResult,
  AssistantChatSnapshot,
  AssistantAudioTranscriptionResult,
  AssistantGatewayRequest,
  AssistantGatewayResponse,
  AgentConnectorRow,
  AgentDetailSnapshot,
  AgentModelRow,
  AgentModelsSnapshot,
  AgentMutationResult,
  ConnectorMutationResult,
  AgentRosterRow,
  AgentRunRow,
  AssignAgentModelCommand,
  ArchiveAssetCommand,
  ArchiveProjectInput,
  AssetListQuery,
  AssetWorkspaceQuery,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  AppActionResult,
  AppApplyRemoteCollaboratorPaymentRowsCommand,
  AppApplyRemoteCollaboratorPaymentRowsResult,
  AppApplyRemoteFinanceBusinessRowsCommand,
  AppApplyRemoteFinanceBusinessRowsResult,
  AppApplyRemoteAssetSnapshotsCommand,
  AppApplyRemoteAssetSnapshotsResult,
  AppApplyRemoteCatalogRowsCommand,
  AppApplyRemoteCatalogRowsResult,
  AppApplyRemoteTreasuryRowsCommand,
  AppApplyRemoteTreasuryRowsResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppInfo,
  AppCreateRemoteWorkspaceCommand,
  AppCreateRemoteWorkspaceResult,
  AppCreateCustomRoleCommand,
  AppCreateCustomRoleResult,
  AppDeleteCustomRoleCommand,
  AppLocalWorkspaceRow,
  AppOperationalBackfillCommand,
  AppOperationalBackfillResult,
  AppRevokeWorkspaceInviteCommand,
  AppSendWorkspaceInviteCommand,
  AppSendWorkspaceInviteResult,
  AppSetRolePermissionCommand,
  AppSetWorkspaceMemberStatusCommand,
  AppStorageUploadResult,
  AppSupportSnapshot,
  AppSyncPullCursorRow,
  AppSyncOutboxRow,
  AppUploadUserAvatarCommand,
  AppUploadWorkspaceImageAssetCommand,
  AppUpsertUserProfileCommand,
  AppUpdateCustomRoleCommand,
  AppUpdateRemoteWorkspaceIdentityCommand,
  AppUpdateWorkspaceMemberRoleCommand,
  EnsureLocalWorkspaceInput,
  AppUserMutationResult,
  AppUsersSnapshot,
  AppUsersSnapshotQuery,
  AssetsOverviewSnapshot,
  CreateAgentCommand,
  CreateAppUserCommand,
  DeleteAppUserCommand,
  CreateAssistantThreadCommand,
  CreateConnectorLinkTokenCommand,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  FileUploadMutationResult,
  FileDeleteMutationResult,
  AssetListRow,
  AssetSummarySnapshot,
  CatalogListQuery,
  CatalogCsvImportPreview,
  CatalogCsvImportResult,
  DeleteCatalogEntitiesInput,
  ExportCatalogCsvInput,
  ImportCatalogCsvInput,
  CatalogSnapshot,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreateFinancialEntryCommand,
  CreateCollaboratorFeeCommand,
  CreateDraftRunFromChatCommand,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  CreateProjectBlueprintInput,
  CreateRmaCaseCommand,
  DeleteAssistantThreadCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  PreviewCatalogCsvImportInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  CollaboratorFeeListQuery,
  CollaboratorFeeRow,
  CollaboratorFeeDetail,
  CollaboratorFeeSummary,
  CollaboratorFeeSuggestion,
  CollaboratorFeeMutationResult,
  FinanceOverviewQuery,
  FinanceEntryMutationResult,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinancialDocumentRow,
  FinanceOverviewSnapshot,
  GlobalSearchGroup,
  GlobalSearchQuery,
  IncidentDetailSnapshot,
  IncidentMutationResult,
  IncidentListQuery,
  IncidentListRow,
  OverviewSnapshot,
  PackingSlipDetailSnapshot,
  PackingSlipListQuery,
  PackingSlipRow,
  ProjectCardRow,
  ProjectCreationConflictsSnapshot,
  ProjectDeletePreview,
  ProjectDetailSnapshot,
  ProjectListQuery,
  RevokeTelegramLinkCommand,
  ReportIncidentCommand,
  ReportIncidentResult,
  ResolveIncidentCommand,
  RecordRuntimeErrorCommand,
  RefreshAIProviderModelsCommand,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
  ScheduleTimelineRange,
  ScheduleTimelinePagination,
  ScheduleTimelineQuery,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  ShellAppAction,
  ShellBootstrap,
  ShowNativeNotificationCommand,
  SetAgentApprovalModeCommand,
  SetActiveAssistantThreadCommand,
  SetAgentStatusCommand,
  SetAppUserActiveCommand,
  SaveAIProviderConfigCommand,
  SaveConnectorConfigCommand,
  MissionControlSnapshot,
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  AssignCrewToProjectUnitInput,
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateCollaboratorFeeCommand,
  ApproveCollaboratorFeeCommand,
  CancelCollaboratorFeeCommand,
  RecordCollaboratorPaymentCommand,
  UpdateAgentCommand,
  UpdateAppUserCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  UpdateIncidentCommand,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshotQuery,
  RmaSnapshot,
  ReviewAgentRunCommand,
  AgentRunReviewResult,
  DraftRunFromChatResult,
  SendAssistantChatTurnCommand,
  TranscribeAssistantAudioCommand,
  RenameAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  StagingPackingSlipRow,
  UnarchiveProjectInput,
} from "@contracts";

const shellActionListeners = new Set<(action: ShellAppAction) => void>();

type StoredSupabaseTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

type AuthUserUpdate = {
  password?: string;
  data?: Record<string, unknown>;
};

ipcRenderer.on(ipcChannels.shell.appAction, (_event, action: ShellAppAction) => {
  shellActionListeners.forEach((listener) => {
    listener(action);
  });
});

const bukowskiApp = {
  getAppInfo: () => ipcRenderer.invoke(ipcChannels.app.getInfo) as Promise<AppInfo>,
  getDiagnostics: () => ipcRenderer.invoke(ipcChannels.app.getDiagnostics) as Promise<AppDiagnosticsSnapshot>,
  getSupportSnapshot: () => ipcRenderer.invoke(ipcChannels.app.getSupportSnapshot) as Promise<AppSupportSnapshot>,
  getUsersSnapshot: (query?: AppUsersSnapshotQuery) =>
    ipcRenderer.invoke(ipcChannels.app.getUsersSnapshot, query) as Promise<AppUsersSnapshot>,
  createBackup: () => ipcRenderer.invoke(ipcChannels.app.createBackup) as Promise<AppActionResult>,
  createUser: (input: CreateAppUserCommand) => ipcRenderer.invoke(ipcChannels.app.createUser, input) as Promise<AppUserMutationResult>,
  updateUser: (input: UpdateAppUserCommand) => ipcRenderer.invoke(ipcChannels.app.updateUser, input) as Promise<AppUserMutationResult>,
  setUserActive: (input: SetAppUserActiveCommand) =>
    ipcRenderer.invoke(ipcChannels.app.setUserActive, input) as Promise<AppUserMutationResult>,
  revokeTelegramLink: (input: RevokeTelegramLinkCommand) =>
    ipcRenderer.invoke(ipcChannels.app.revokeTelegramLink, input) as Promise<AppUserMutationResult>,
  deleteUser: (input: DeleteAppUserCommand) => ipcRenderer.invoke(ipcChannels.app.deleteUser, input) as Promise<AppUserMutationResult>,
  ensureLocalWorkspaces: (workspaces: EnsureLocalWorkspaceInput[]) =>
    ipcRenderer.invoke(ipcChannels.app.ensureLocalWorkspaces, workspaces) as Promise<AppActionResult>,
  getLocalWorkspaces: (query?: { userId?: string | null }) =>
    ipcRenderer.invoke(ipcChannels.app.getLocalWorkspaces, query) as Promise<AppLocalWorkspaceRow[]>,
  createRemoteWorkspace: (input: AppCreateRemoteWorkspaceCommand) =>
    ipcRenderer.invoke(ipcChannels.app.createRemoteWorkspace, input) as Promise<AppCreateRemoteWorkspaceResult>,
  sendWorkspaceInvite: (input: AppSendWorkspaceInviteCommand) =>
    ipcRenderer.invoke(ipcChannels.app.sendWorkspaceInvite, input) as Promise<AppSendWorkspaceInviteResult>,
  upsertUserProfile: (input: AppUpsertUserProfileCommand) =>
    ipcRenderer.invoke(ipcChannels.app.upsertUserProfile, input) as Promise<void>,
  uploadUserAvatar: (input: AppUploadUserAvatarCommand) =>
    ipcRenderer.invoke(ipcChannels.app.uploadUserAvatar, input) as Promise<AppStorageUploadResult>,
  uploadWorkspaceImageAsset: (input: AppUploadWorkspaceImageAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.app.uploadWorkspaceImageAsset, input) as Promise<AppStorageUploadResult>,
  updateRemoteWorkspaceIdentity: (input: AppUpdateRemoteWorkspaceIdentityCommand) =>
    ipcRenderer.invoke(ipcChannels.app.updateRemoteWorkspaceIdentity, input) as Promise<void>,
  updateWorkspaceMemberRole: (input: AppUpdateWorkspaceMemberRoleCommand) =>
    ipcRenderer.invoke(ipcChannels.app.updateWorkspaceMemberRole, input) as Promise<void>,
  setWorkspaceMemberStatus: (input: AppSetWorkspaceMemberStatusCommand) =>
    ipcRenderer.invoke(ipcChannels.app.setWorkspaceMemberStatus, input) as Promise<void>,
  revokeWorkspaceInvite: (input: AppRevokeWorkspaceInviteCommand) =>
    ipcRenderer.invoke(ipcChannels.app.revokeWorkspaceInvite, input) as Promise<void>,
  createCustomRole: (input: AppCreateCustomRoleCommand) =>
    ipcRenderer.invoke(ipcChannels.app.createCustomRole, input) as Promise<AppCreateCustomRoleResult>,
  updateCustomRole: (input: AppUpdateCustomRoleCommand) =>
    ipcRenderer.invoke(ipcChannels.app.updateCustomRole, input) as Promise<void>,
  deleteCustomRole: (input: AppDeleteCustomRoleCommand) =>
    ipcRenderer.invoke(ipcChannels.app.deleteCustomRole, input) as Promise<void>,
  setRolePermission: (input: AppSetRolePermissionCommand) =>
    ipcRenderer.invoke(ipcChannels.app.setRolePermission, input) as Promise<void>,
  runIntegrityCheck: () => ipcRenderer.invoke(ipcChannels.app.runIntegrityCheck) as Promise<AppActionResult>,
  runLocalSync: () => ipcRenderer.invoke(ipcChannels.app.runLocalSync) as Promise<AppActionResult>,
  getSyncOutboxRows: () => ipcRenderer.invoke(ipcChannels.app.getSyncOutboxRows) as Promise<AppSyncOutboxRow[]>,
  getSyncPullCursors: () =>
    ipcRenderer.invoke(ipcChannels.app.getSyncPullCursors) as Promise<AppSyncPullCursorRow[]>,
  retrySyncOutboxRow: (id: string) =>
    ipcRenderer.invoke(ipcChannels.app.retrySyncOutboxRow, id) as Promise<AppActionResult>,
  retryAllFailedSyncOutboxRows: () =>
    ipcRenderer.invoke(ipcChannels.app.retryAllFailedSyncOutboxRows) as Promise<AppActionResult>,
  backfillOperationalSnapshots: (input: AppOperationalBackfillCommand) =>
    ipcRenderer.invoke(ipcChannels.app.backfillOperationalSnapshots, input) as Promise<AppOperationalBackfillResult>,
  exportWorkspaceData: () => ipcRenderer.invoke(ipcChannels.app.exportWorkspaceData) as Promise<AppExportResult>,
  exportSupportBundle: () => ipcRenderer.invoke(ipcChannels.app.exportSupportBundle) as Promise<AppExportResult>,
  exportRecentLogs: () => ipcRenderer.invoke(ipcChannels.app.exportRecentLogs) as Promise<AppExportResult>,
  openExternal: (url: string) => ipcRenderer.invoke(ipcChannels.app.openExternal, url) as Promise<void>,
  writeClipboard: (text: string) => ipcRenderer.invoke(ipcChannels.app.writeClipboard, text) as Promise<void>,
  getDocumentsRoot: () =>
    ipcRenderer.invoke(ipcChannels.app.getDocumentsRoot) as Promise<{
      root: string;
      isCustom: boolean;
      defaultRoot: string;
    }>,
  chooseDocumentsRoot: () =>
    ipcRenderer.invoke(ipcChannels.app.chooseDocumentsRoot) as Promise<{
      root: string;
      isCustom: boolean;
      defaultRoot: string;
    }>,
  resetDocumentsRoot: () =>
    ipcRenderer.invoke(ipcChannels.app.resetDocumentsRoot) as Promise<{
      root: string;
      isCustom: boolean;
      defaultRoot: string;
    }>,
  applyRemoteCatalogRows: (input: AppApplyRemoteCatalogRowsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteCatalogRows, input) as Promise<AppApplyRemoteCatalogRowsResult>,
  applyRemoteExchangeRates: (input: import("@contracts").AppApplyRemoteExchangeRatesCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteExchangeRates, input) as Promise<
      import("@contracts").AppApplyRemoteExchangeRatesResult
    >,
  applyRemoteAssetSnapshots: (input: AppApplyRemoteAssetSnapshotsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteAssetSnapshots, input) as Promise<AppApplyRemoteAssetSnapshotsResult>,
  applyRemoteOperationalSnapshots: (input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteOperationalSnapshots, input) as Promise<
      import("@contracts").AppApplyRemoteOperationalSnapshotsResult
    >,
  applyRemoteTreasuryRows: (input: AppApplyRemoteTreasuryRowsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteTreasuryRows, input) as Promise<AppApplyRemoteTreasuryRowsResult>,
  applyRemoteCollaboratorPaymentRows: (input: AppApplyRemoteCollaboratorPaymentRowsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteCollaboratorPaymentRows, input) as Promise<
      AppApplyRemoteCollaboratorPaymentRowsResult
    >,
  applyRemoteFinanceBusinessRows: (input: AppApplyRemoteFinanceBusinessRowsCommand) =>
    ipcRenderer.invoke(ipcChannels.app.applyRemoteFinanceBusinessRows, input) as Promise<
      AppApplyRemoteFinanceBusinessRowsResult
    >,
};

const bukowskiAuth = {
  getAccessToken: () => ipcRenderer.invoke(ipcChannels.auth.getAccessToken) as Promise<string | null>,
  getOAuthRedirectUrl: () => ipcRenderer.invoke(ipcChannels.auth.getOAuthRedirectUrl) as Promise<string>,
  getAvatarDataUrl: (url: string) => ipcRenderer.invoke(ipcChannels.auth.getAvatarDataUrl, url) as Promise<string | null>,
  updateUser: (input: AuthUserUpdate) => ipcRenderer.invoke(ipcChannels.auth.updateUser, input) as Promise<unknown>,
  setStoredTokens: (tokens: StoredSupabaseTokens & { remember?: boolean }) =>
    ipcRenderer.invoke(ipcChannels.auth.setStoredTokens, tokens) as Promise<void>,
  clearStoredTokens: () => ipcRenderer.invoke(ipcChannels.auth.clearStoredTokens) as Promise<void>,
};

const bukowskiNotifications = {
  showNative: (input: ShowNativeNotificationCommand) =>
    ipcRenderer.invoke(ipcChannels.notifications.showNative, input) as Promise<void>,
  setDockBadge: (count: number) => ipcRenderer.invoke(ipcChannels.notifications.setDockBadge, count) as Promise<void>,
  getForegroundState: () =>
    ipcRenderer.invoke(ipcChannels.notifications.getForegroundState) as Promise<{ isForeground: boolean }>,
};

const bukowskiShell = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.shell.getBootstrap) as Promise<ShellBootstrap>,
  searchGlobal: (query: GlobalSearchQuery) => ipcRenderer.invoke(ipcChannels.shell.searchGlobal, query) as Promise<GlobalSearchGroup[]>,
  onAppAction: (listener: (action: ShellAppAction) => void) => {
    shellActionListeners.add(listener);

    return () => {
      shellActionListeners.delete(listener);
    };
  },
};

const bukowskiOverview = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.overview.getSnapshot) as Promise<OverviewSnapshot>,
  getTimeline: (
    range: ScheduleTimelineRange,
    scale: ScheduleTimelineScale,
    anchorDate?: string,
    query?: ScheduleTimelineQuery,
  ) =>
    ipcRenderer.invoke(ipcChannels.overview.getTimeline, range, scale, anchorDate, query) as Promise<ScheduleTimelineSnapshot>,
};

const bukowskiAgents = {
  getMissionControlSnapshot: () =>
    ipcRenderer.invoke(ipcChannels.agents.getMissionControlSnapshot) as Promise<MissionControlSnapshot>,
  getAgentsList: () => ipcRenderer.invoke(ipcChannels.agents.getAgentsList) as Promise<AgentRosterRow[]>,
  getAgentDetail: (agentId: string) => ipcRenderer.invoke(ipcChannels.agents.getAgentDetail, agentId) as Promise<AgentDetailSnapshot>,
  getRunsList: () => ipcRenderer.invoke(ipcChannels.agents.getRunsList) as Promise<AgentRunRow[]>,
  getModelsSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getModelsSnapshot) as Promise<AgentModelsSnapshot>,
  getAIProviderConfigs: () => ipcRenderer.invoke(ipcChannels.agents.getAIProviderConfigs) as Promise<AgentModelRow[]>,
  getConnectorsSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getConnectorsSnapshot) as Promise<AgentConnectorRow[]>,
  getAssistantChatSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getAssistantChatSnapshot) as Promise<AssistantChatSnapshot>,
  create: (input: CreateAgentCommand) => ipcRenderer.invoke(ipcChannels.agents.create, input) as Promise<AgentMutationResult>,
  update: (input: UpdateAgentCommand) => ipcRenderer.invoke(ipcChannels.agents.update, input) as Promise<AgentMutationResult>,
  setStatus: (input: SetAgentStatusCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setStatus, input) as Promise<AgentMutationResult>,
  setApprovalMode: (input: SetAgentApprovalModeCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setApprovalMode, input) as Promise<AgentMutationResult>,
  saveAIProviderConfig: (input: SaveAIProviderConfigCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.saveAIProviderConfig, input) as Promise<AIProviderMutationResult>,
  refreshAIProviderModels: (input: RefreshAIProviderModelsCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.refreshAIProviderModels, input) as Promise<AIProviderMutationResult>,
  saveConnectorConfig: (input: SaveConnectorConfigCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.saveConnectorConfig, input) as Promise<ConnectorMutationResult>,
  testAIProviderConnection: (input: TestAIProviderConnectionCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.testAIProviderConnection, input) as Promise<AIProviderMutationResult>,
  testConnectorConnection: (input: TestConnectorConnectionCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.testConnectorConnection, input) as Promise<ConnectorMutationResult>,
  createConnectorLinkToken: (input: CreateConnectorLinkTokenCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.createConnectorLinkToken, input) as Promise<ConnectorMutationResult>,
  assignAgentModel: (input: AssignAgentModelCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.assignAgentModel, input) as Promise<AgentMutationResult>,
  createAssistantThread: (input: CreateAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.createAssistantThread, input) as Promise<AssistantChatSnapshot>,
  deleteAssistantThread: (input: DeleteAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.deleteAssistantThread, input) as Promise<AssistantChatSnapshot>,
  setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setActiveAssistantThread, input) as Promise<AssistantChatSnapshot>,
  updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.updateAssistantThreadPreferences, input) as Promise<AssistantChatSnapshot>,
  renameAssistantThread: (input: RenameAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.renameAssistantThread, input) as Promise<AssistantChatSnapshot>,
  sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.sendAssistantChatTurn, input) as Promise<AssistantChatSnapshot>,
  transcribeAudio: (input: TranscribeAssistantAudioCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.transcribeAudio, input) as Promise<AssistantAudioTranscriptionResult>,
  reviewRun: (input: ReviewAgentRunCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.reviewRun, input) as Promise<AgentRunReviewResult>,
  sendAssistantMessage: (input: AssistantGatewayRequest) =>
    ipcRenderer.invoke(ipcChannels.agents.sendAssistantMessage, input) as Promise<AssistantGatewayResponse>,
  createDraftRunFromChat: (input: CreateDraftRunFromChatCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.createDraftRunFromChat, input) as Promise<DraftRunFromChatResult>,
};

const bukowskiAssets = {
  getList: (query?: AssetListQuery) => ipcRenderer.invoke(ipcChannels.assets.getList, query) as Promise<AssetListRow[]>,
  getSummary: (query?: AssetWorkspaceQuery) => ipcRenderer.invoke(ipcChannels.assets.getSummary, query) as Promise<AssetSummarySnapshot>,
  getOverview: (query?: AssetWorkspaceQuery) => ipcRenderer.invoke(ipcChannels.assets.getOverview, query) as Promise<AssetsOverviewSnapshot>,
  getDetail: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.getDetail, assetId) as Promise<AssetDetailSnapshot>,
  uploadFiles: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.uploadFiles, assetId) as Promise<FileUploadMutationResult>,
  uploadImages: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.uploadImages, assetId) as Promise<FileUploadMutationResult>,
  openFile: (fileId: string) => ipcRenderer.invoke(ipcChannels.assets.openFile, fileId) as Promise<void>,
  deleteFile: (fileId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.deleteFile, fileId) as Promise<FileDeleteMutationResult>,
  assignMove: (input: AssignMoveAssetsInput) =>
    ipcRenderer.invoke(ipcChannels.assets.assignMove, input) as Promise<AssignMoveAssetsResult>,
  create: (input: CreateAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.create, input) as Promise<AssetEditorMutationResult>,
  update: (input: UpdateAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.update, input) as Promise<AssetEditorMutationResult>,
  archive: (input: ArchiveAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.archive, input) as Promise<AssetEditorMutationResult>,
};

const bukowskiPacking = {
  getList: (query?: PackingSlipListQuery) => ipcRenderer.invoke(ipcChannels.packing.getList, query) as Promise<PackingSlipRow[]>,
  getDetail: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.getDetail, packingSlipId) as Promise<PackingSlipDetailSnapshot>,
  exportPdf: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.exportPdf, packingSlipId) as Promise<AppExportResult>,
  exportInsurancePdf: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.exportInsurancePdf, packingSlipId) as Promise<AppExportResult>,
  create: (input: CreatePackingSlipCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.create, input) as Promise<CreatePackingSlipResult>,
  returnItems: (input: ReturnPackingSlipItemsCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.returnItems, input) as Promise<ReturnPackingSlipItemsResult>,
};

const bukowskiIncidents = {
  getList: (query?: IncidentListQuery) => ipcRenderer.invoke(ipcChannels.incidents.getList, query) as Promise<IncidentListRow[]>,
  getDetail: (incidentId: string) =>
    ipcRenderer.invoke(ipcChannels.incidents.getDetail, incidentId) as Promise<IncidentDetailSnapshot>,
  uploadFiles: (incidentId: string) =>
    ipcRenderer.invoke(ipcChannels.incidents.uploadFiles, incidentId) as Promise<FileUploadMutationResult>,
  openFile: (fileId: string) => ipcRenderer.invoke(ipcChannels.incidents.openFile, fileId) as Promise<void>,
  report: (input: ReportIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.report, input) as Promise<ReportIncidentResult>,
  update: (input: UpdateIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.update, input) as Promise<IncidentMutationResult>,
  resolve: (input: ResolveIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.resolve, input) as Promise<IncidentMutationResult>,
};

const bukowskiProjects = {
  getList: (query?: ProjectListQuery) => ipcRenderer.invoke(ipcChannels.projects.getList, query) as Promise<ProjectCardRow[]>,
  getDetail: (projectId: string) => ipcRenderer.invoke(ipcChannels.projects.getDetail, projectId) as Promise<ProjectDetailSnapshot>,
  getDeletePreview: (projectId: string) =>
    ipcRenderer.invoke(ipcChannels.projects.getDeletePreview, projectId) as Promise<ProjectDeletePreview>,
  getCatalog: (query?: AssetWorkspaceQuery) => ipcRenderer.invoke(ipcChannels.projects.getCatalog, query) as Promise<CatalogSnapshot>,
  getStagingPackingSlips: () =>
    ipcRenderer.invoke(ipcChannels.projects.getStagingPackingSlips) as Promise<StagingPackingSlipRow[]>,
  getCreationConflicts: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.getCreationConflicts, input) as Promise<ProjectCreationConflictsSnapshot>,
  create: (input: CreateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.create, input) as Promise<ProjectCardRow[]>,
  createBlueprint: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.createBlueprint, input) as Promise<ProjectCardRow[]>,
  exportBlueprintPdf: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.exportBlueprintPdf, input) as Promise<AppExportResult>,
  update: (input: UpdateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.update, input) as Promise<ProjectCardRow[]>,
  archive: (input: ArchiveProjectInput) => ipcRenderer.invoke(ipcChannels.projects.archive, input) as Promise<ProjectCardRow[]>,
  unarchive: (input: UnarchiveProjectInput) =>
    ipcRenderer.invoke(ipcChannels.projects.unarchive, input) as Promise<ProjectCardRow[]>,
  remove: (input: DeleteProjectInput) => ipcRenderer.invoke(ipcChannels.projects.delete, input) as Promise<ProjectCardRow[]>,
  createUnit: (input: CreateProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.createUnit, input) as Promise<ProjectDetailSnapshot>,
  updateUnit: (input: UpdateProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.updateUnit, input) as Promise<ProjectDetailSnapshot>,
  removeUnit: (input: DeleteProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.deleteUnit, input) as Promise<ProjectDetailSnapshot>,
  assignCrewToUnit: (input: AssignCrewToProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.assignCrewToUnit, input) as Promise<ProjectDetailSnapshot>,
  unassignCrewFromUnit: (input: UnassignCrewFromProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.unassignCrewFromUnit, input) as Promise<ProjectDetailSnapshot>,
};

const bukowskiFinance = {
  getOverview: (query?: FinanceOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.finance.getOverview, query) as Promise<FinanceOverviewSnapshot>,
  exportReportPdf: (query?: FinanceOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.finance.exportReportPdf, query) as Promise<AppExportResult>,
  getCostLinks: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.getCostLinks, { workspaceId }) as Promise<FinanceCostLinkRow[]>,
  getEntries: (query?: FinanceEntryListQuery) => ipcRenderer.invoke(ipcChannels.finance.getEntries, query) as Promise<FinanceEntryRow[]>,
  getDocuments: (entryId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.getDocuments, entryId) as Promise<FinancialDocumentRow[]>,
  uploadDocuments: (entryId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.uploadDocuments, entryId) as Promise<FileUploadMutationResult>,
  openDocument: (fileId: string) => ipcRenderer.invoke(ipcChannels.finance.openDocument, fileId) as Promise<void>,
  create: (input: CreateFinancialEntryCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.create, input) as Promise<FinanceEntryMutationResult>,
  update: (input: UpdateFinancialEntryCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.update, input) as Promise<FinanceEntryMutationResult>,
  listCollaboratorFees: (query?: CollaboratorFeeListQuery) =>
    ipcRenderer.invoke(ipcChannels.finance.listCollaboratorFees, query) as Promise<CollaboratorFeeRow[]>,
  getCollaboratorFeeDetail: (workspaceId: string, feeId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.getCollaboratorFeeDetail, { workspaceId, feeId }) as Promise<CollaboratorFeeDetail | null>,
  getCollaboratorFeeSummary: (workspaceId: string, projectId?: string | null) =>
    ipcRenderer.invoke(ipcChannels.finance.getCollaboratorFeeSummary, { workspaceId, projectId: projectId ?? null }) as Promise<CollaboratorFeeSummary>,
  suggestCollaboratorFees: (input: { workspaceId: string; projectId?: string | null; crewMemberId?: string | null }) =>
    ipcRenderer.invoke(ipcChannels.finance.suggestCollaboratorFees, input) as Promise<CollaboratorFeeSuggestion[]>,
  createCollaboratorFee: (input: CreateCollaboratorFeeCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.createCollaboratorFee, input) as Promise<CollaboratorFeeMutationResult>,
  updateCollaboratorFee: (input: UpdateCollaboratorFeeCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.updateCollaboratorFee, input) as Promise<CollaboratorFeeMutationResult>,
  approveCollaboratorFee: (input: ApproveCollaboratorFeeCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.approveCollaboratorFee, input) as Promise<CollaboratorFeeMutationResult>,
  cancelCollaboratorFee: (input: CancelCollaboratorFeeCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.cancelCollaboratorFee, input) as Promise<CollaboratorFeeMutationResult>,
  recordCollaboratorPayment: (input: RecordCollaboratorPaymentCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.recordCollaboratorPayment, input) as Promise<CollaboratorFeeMutationResult>,
};

const bukowskiCurrency = {
  getSettings: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.currency.getSettings, { workspaceId }) as Promise<
      import("@contracts").CurrencySettingsRow
    >,
  listRates: (input: { workspaceId: string; baseCurrency?: string; quoteCurrency?: string; limit?: number }) =>
    ipcRenderer.invoke(ipcChannels.currency.listRates, input) as Promise<import("@contracts").ExchangeRateRow[]>,
  getLatestRate: (input: {
    workspaceId: string;
    baseCurrency: string;
    quoteCurrency: string;
    rateType?: import("@contracts").CurrencyRateType;
  }) =>
    ipcRenderer.invoke(ipcChannels.currency.getLatestRate, input) as Promise<
      import("@contracts").ExchangeRateRow | null
    >,
  upsertSettings: (input: import("@contracts").UpsertCurrencySettingsCommand) =>
    ipcRenderer.invoke(ipcChannels.currency.upsertSettings, input) as Promise<
      import("@contracts").CurrencySettingsMutationResult
    >,
  createRate: (input: import("@contracts").CreateExchangeRateCommand) =>
    ipcRenderer.invoke(ipcChannels.currency.createRate, input) as Promise<
      import("@contracts").ExchangeRateMutationResult
    >,
  deleteRate: (input: import("@contracts").DeleteExchangeRateCommand) =>
    ipcRenderer.invoke(ipcChannels.currency.deleteRate, input) as Promise<
      import("@contracts").ExchangeRateMutationResult
    >,
  getProviderStatus: (input: {
    workspaceId: string;
    provider: import("@contracts").CurrencyRateProviderKey;
  }) =>
    ipcRenderer.invoke(ipcChannels.currency.getProviderStatus, input) as Promise<
      import("@contracts").CurrencyRateProviderStatus
    >,
  saveProviderConfig: (input: import("@contracts").SaveCurrencyRateProviderConfigCommand) =>
    ipcRenderer.invoke(ipcChannels.currency.saveProviderConfig, input) as Promise<
      import("@contracts").CurrencyRateProviderStatus
    >,
  refreshRates: (input: import("@contracts").RefreshCurrencyRatesCommand) =>
    ipcRenderer.invoke(ipcChannels.currency.refreshRates, input) as Promise<
      import("@contracts").RefreshCurrencyRatesResult
    >,
};

const bukowskiQuotes = {
  list: (filter: import("@contracts").QuoteListFilter) =>
    ipcRenderer.invoke(ipcChannels.quotes.list, filter) as Promise<import("@contracts").QuoteRow[]>,
  detail: (workspaceId: string, quoteId: string) =>
    ipcRenderer.invoke(ipcChannels.quotes.detail, { workspaceId, quoteId }) as Promise<
      import("@contracts").QuoteDetail | null
    >,
  create: (input: import("@contracts").CreateQuoteCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.create, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  update: (input: import("@contracts").UpdateQuoteCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.update, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  setStatus: (input: import("@contracts").SetQuoteStatusCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.setStatus, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  duplicate: (input: import("@contracts").DuplicateQuoteCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.duplicate, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  delete: (input: import("@contracts").DuplicateQuoteCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.delete, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  renumber: (input: import("@contracts").RenumberQuoteCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.renumber, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
  exportPdf: (workspaceId: string, quoteId: string) =>
    ipcRenderer.invoke(ipcChannels.quotes.exportPdf, { workspaceId, quoteId }) as Promise<AppExportResult>,
  listVersions: (workspaceId: string, quoteId: string) =>
    ipcRenderer.invoke(ipcChannels.quotes.listVersions, { workspaceId, quoteId }) as Promise<
      Array<{
        id: string;
        versionNumber: number;
        changeSummary: string | null;
        createdAt: string;
        createdByUserId: string | null;
        snapshot: Record<string, unknown>;
      }>
    >,
  restoreVersion: (input: import("@contracts").RestoreQuoteFromVersionCommand) =>
    ipcRenderer.invoke(ipcChannels.quotes.restoreVersion, input) as Promise<
      import("@contracts").QuoteMutationResult
    >,
};

const bukowskiInvoices = {
  list: (filter: import("@contracts").InvoiceListFilter) =>
    ipcRenderer.invoke(ipcChannels.invoices.list, filter) as Promise<
      import("@contracts").InvoiceRow[]
    >,
  detail: (workspaceId: string, invoiceId: string) =>
    ipcRenderer.invoke(ipcChannels.invoices.detail, { workspaceId, invoiceId }) as Promise<
      import("@contracts").InvoiceDetail | null
    >,
  exportPdf: (workspaceId: string, invoiceId: string) =>
    ipcRenderer.invoke(ipcChannels.invoices.exportPdf, { workspaceId, invoiceId }) as Promise<
      import("@contracts").AppExportResult
    >,
  create: (input: import("@contracts").CreateInvoiceCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.create, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  update: (input: import("@contracts").UpdateInvoiceCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.update, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  issue: (input: import("@contracts").IssueInvoiceCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.issue, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  cancel: (input: import("@contracts").CancelInvoiceCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.cancel, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  recordPayment: (input: import("@contracts").RecordInvoicePaymentCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.recordPayment, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  renumber: (input: import("@contracts").RenumberInvoiceCommand) =>
    ipcRenderer.invoke(ipcChannels.invoices.renumber, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
  createFromQuote: (input: { workspaceId: string; quoteId: string; commandId: string }) =>
    ipcRenderer.invoke(ipcChannels.invoices.createFromQuote, input) as Promise<
      import("@contracts").InvoiceMutationResult
    >,
};

const bukowskiTreasury = {
  listAccounts: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.listAccounts, { workspaceId }) as Promise<
      import("@contracts").BankAccountRow[]
    >,
  upsertAccount: (input: import("@contracts").UpsertBankAccountCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.upsertAccount, input) as Promise<
      import("@contracts").BankAccountMutationResult
    >,
  listTransactions: (query: import("@contracts").TreasuryTransactionListQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.listTransactions, query) as Promise<
      import("@contracts").BankTransactionRow[]
    >,
  previewClassificationRule: (query: import("@contracts").CounterpartyRulePreviewQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.previewClassificationRule, query) as Promise<
      import("@contracts").CounterpartyRulePreview
    >,
  listImports: (workspaceId: string, bankAccountId?: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.listImports, { workspaceId, bankAccountId }) as Promise<
      import("@contracts").BankStatementImportRow[]
    >,
  listExpenseCategories: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.listExpenseCategories, { workspaceId }) as Promise<string[]>,
  overview: (query: import("@contracts").TreasuryOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.overview, query) as Promise<
      import("@contracts").TreasuryOverviewSnapshot
    >,
  exportOverviewPdf: (query: import("@contracts").TreasuryOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.exportOverviewPdf, query) as Promise<import("@contracts").AppExportResult>,
  reviewQueue: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.reviewQueue, { workspaceId }) as Promise<
      import("@contracts").ReviewQueueRow[]
    >,
  projectPnl: (workspaceId: string, dateFrom?: string, dateTo?: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.projectPnl, { workspaceId, dateFrom, dateTo }) as Promise<
      import("@contracts").ProjectPnlRow[]
    >,
  undoPreview: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.undoPreview, { workspaceId }) as Promise<
      import("@contracts").TreasuryUndoPreview
    >,
  deductibleLedger: (query: import("@contracts").TreasuryDeductibleLedgerQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.deductibleLedger, query) as Promise<
      import("@contracts").TreasuryDeductibleLedger
    >,
  exportDeductibleLedger: (input: import("@contracts").TreasuryDeductibleLedgerExportInput) =>
    ipcRenderer.invoke(ipcChannels.treasury.exportDeductibleLedger, input) as Promise<
      import("@contracts").AppExportResult
    >,
  dgiiReport: (query: import("@contracts").DgiiReportQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.dgiiReport, query) as Promise<import("@contracts").DgiiReport>,
  exportDgiiReport: (input: import("@contracts").DgiiReportExportInput) =>
    ipcRenderer.invoke(ipcChannels.treasury.exportDgiiReport, input) as Promise<import("@contracts").AppExportResult>,
  importStatement: (input: import("@contracts").ImportStatementCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.importStatement, input) as Promise<
      import("@contracts").ImportStatementResult
    >,
  addManualTransactions: (input: import("@contracts").AddManualTransactionsCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.addManualTransactions, input) as Promise<
      import("@contracts").ImportStatementResult
    >,
  deleteImport: (input: import("@contracts").DeleteImportCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.deleteImport, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  correctTransaction: (input: import("@contracts").CorrectTransactionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.correctTransaction, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  annotateTransaction: (input: import("@contracts").AnnotateTransactionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.annotateTransaction, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  applyClassificationRule: (input: import("@contracts").ApplyCounterpartyRuleCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.applyClassificationRule, input) as Promise<
      import("@contracts").ApplyCounterpartyRuleResult
    >,
  setAllocations: (input: import("@contracts").SetAllocationsCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.setAllocations, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  reviewReimbursement: (input: import("@contracts").ReviewReimbursementCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.reviewReimbursement, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  linkTransaction: (input: import("@contracts").LinkTransactionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.linkTransaction, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  undoLastAction: (input: import("@contracts").UndoTreasuryActionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.undoLastAction, input) as Promise<
      import("@contracts").TransactionMutationResult
    >,
  invoiceInboxEnqueue: (input: import("@contracts").EnqueueInvoiceBatchCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxEnqueue, input) as Promise<
      import("@contracts").EnqueueInvoiceBatchResult
    >,
  invoiceInboxList: (query: import("@contracts").InvoiceInboxListQuery) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxList, query) as Promise<
      import("@contracts").InvoiceExtraction[]
    >,
  invoiceInboxUpdate: (input: import("@contracts").UpdateInvoiceExtractionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxUpdate, input) as Promise<
      import("@contracts").InvoiceExtractionMutationResult
    >,
  invoiceInboxBulkLink: (input: import("@contracts").BulkLinkInvoiceExtractionsCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxBulkLink, input) as Promise<
      import("@contracts").BulkLinkInvoiceExtractionsResult
    >,
  invoiceInboxRetry: (input: import("@contracts").RetryInvoiceExtractionsCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxRetry, input) as Promise<
      import("@contracts").RetryInvoiceExtractionsResult
    >,
  invoiceInboxPreview: (workspaceId: string, extractionId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxPreview, { workspaceId, extractionId }) as Promise<
      { fileName: string; mimeType: string; dataUrl: string } | null
    >,
  invoiceInboxDownload: (workspaceId: string, extractionId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxDownload, { workspaceId, extractionId }) as Promise<
      import("@contracts").AppExportResult
    >,
  invoiceInboxDownloadBatch: (workspaceId: string, extractionIds: string[]) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxDownloadBatch, { workspaceId, extractionIds }) as Promise<
      import("@contracts").AppExportResult
    >,
  invoiceInboxDuplicates: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxDuplicates, { workspaceId }) as Promise<
      import("@contracts").InvoiceDuplicateGroup[]
    >,
  invoiceInboxBackfillHashes: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxBackfillHashes, { workspaceId }) as Promise<number>,
  invoiceInboxApply: (input: import("@contracts").ApplyInvoiceExtractionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxApply, input) as Promise<
      import("@contracts").InvoiceExtractionMutationResult
    >,
  invoiceInboxDismiss: (input: import("@contracts").DismissInvoiceExtractionCommand) =>
    ipcRenderer.invoke(ipcChannels.treasury.invoiceInboxDismiss, input) as Promise<
      import("@contracts").InvoiceExtractionMutationResult
    >,
};

const bukowskiLicenses = {
  list: (workspaceId: string) =>
    ipcRenderer.invoke(ipcChannels.licenses.list, { workspaceId }) as Promise<
      import("@contracts").SoftwareLicenseRow[]
    >,
  upsert: (input: import("@contracts").UpsertSoftwareLicenseCommand) =>
    ipcRenderer.invoke(ipcChannels.licenses.upsert, input) as Promise<
      import("@contracts").SoftwareLicenseMutationResult
    >,
  archive: (input: import("@contracts").ArchiveSoftwareLicenseCommand) =>
    ipcRenderer.invoke(ipcChannels.licenses.archive, input) as Promise<
      import("@contracts").SoftwareLicenseMutationResult
    >,
  setSeats: (input: import("@contracts").SetLicenseSeatsCommand) =>
    ipcRenderer.invoke(ipcChannels.licenses.setSeats, input) as Promise<
      import("@contracts").SoftwareLicenseMutationResult
    >,
};

const bukowskiCatalog = {
  getSnapshot: (query?: CatalogListQuery) => ipcRenderer.invoke(ipcChannels.catalog.getSnapshot, query) as Promise<CatalogSnapshot>,
  create: (input: CreateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.create, input) as Promise<CatalogSnapshot>,
  update: (input: UpdateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.update, input) as Promise<CatalogSnapshot>,
  remove: (input: DeleteCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.delete, input) as Promise<CatalogSnapshot>,
  removeMany: (input: DeleteCatalogEntitiesInput) => ipcRenderer.invoke(ipcChannels.catalog.deleteMany, input) as Promise<CatalogSnapshot>,
  exportCsv: (input: ExportCatalogCsvInput) => ipcRenderer.invoke(ipcChannels.catalog.exportCsv, input) as Promise<AppExportResult>,
  previewImportCsv: (input: PreviewCatalogCsvImportInput) =>
    ipcRenderer.invoke(ipcChannels.catalog.previewImportCsv, input) as Promise<CatalogCsvImportPreview>,
  importCsv: (input: ImportCatalogCsvInput) =>
    ipcRenderer.invoke(ipcChannels.catalog.importCsv, input) as Promise<{ result: CatalogCsvImportResult; snapshot: CatalogSnapshot }>,
  uploadCrewDocuments: (workspaceId: string, crewMemberId: string, sourceFilePaths?: string[]) =>
    ipcRenderer.invoke(ipcChannels.catalog.uploadCrewDocuments, { workspaceId, crewMemberId, sourceFilePaths }) as Promise<FileUploadMutationResult>,
  openCrewDocument: (fileId: string) => ipcRenderer.invoke(ipcChannels.catalog.openCrewDocument, fileId) as Promise<void>,
  deleteCrewDocument: (fileId: string) => ipcRenderer.invoke(ipcChannels.catalog.deleteCrewDocument, fileId) as Promise<FileDeleteMutationResult>,
};

const bukowskiRma = {
  getSnapshot: (query?: RmaSnapshotQuery) => ipcRenderer.invoke(ipcChannels.rma.getSnapshot, query) as Promise<RmaSnapshot>,
  getDetail: (rmaCaseId: string) => ipcRenderer.invoke(ipcChannels.rma.getDetail, rmaCaseId) as Promise<RmaCaseDetailSnapshot>,
  create: (input: CreateRmaCaseCommand) => ipcRenderer.invoke(ipcChannels.rma.create, input) as Promise<RmaCaseMutationResult>,
  update: (input: UpdateRmaCaseCommand) => ipcRenderer.invoke(ipcChannels.rma.update, input) as Promise<RmaCaseMutationResult>,
};

const reportRuntimeError = (input: RecordRuntimeErrorCommand) =>
  ipcRenderer.invoke(ipcChannels.app.reportRuntimeError, input).catch(() => undefined);

window.addEventListener("error", (event) => {
  const runtimeError = event.error instanceof Error ? event.error : null;

  void reportRuntimeError({
    sourceKind: "renderer",
    processLabel: "Renderer",
    errorName: runtimeError?.name ?? "window.error",
    message: runtimeError?.message ?? event.message ?? "Renderer error",
    stack: runtimeError?.stack ?? null,
    severity: "medium",
    context: {
      pathname: window.location.pathname,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

  void reportRuntimeError({
    sourceKind: "renderer",
    processLabel: "Renderer",
    errorName: reason.name || "unhandledrejection",
    message: reason.message || "Unhandled renderer rejection",
    stack: reason.stack ?? null,
    severity: "medium",
    context: {
      pathname: window.location.pathname,
    },
  });
});

contextBridge.exposeInMainWorld("bukowskiApp", bukowskiApp);
contextBridge.exposeInMainWorld("bukowskiAuth", bukowskiAuth);
contextBridge.exposeInMainWorld("bukowskiNotifications", bukowskiNotifications);
contextBridge.exposeInMainWorld("bukowskiShell", bukowskiShell);
contextBridge.exposeInMainWorld("bukowskiAgents", bukowskiAgents);
contextBridge.exposeInMainWorld("bukowskiOverview", bukowskiOverview);
contextBridge.exposeInMainWorld("bukowskiAssets", bukowskiAssets);
contextBridge.exposeInMainWorld("bukowskiPacking", bukowskiPacking);
contextBridge.exposeInMainWorld("bukowskiIncidents", bukowskiIncidents);
contextBridge.exposeInMainWorld("bukowskiProjects", bukowskiProjects);
contextBridge.exposeInMainWorld("bukowskiFinance", bukowskiFinance);
contextBridge.exposeInMainWorld("bukowskiCurrency", bukowskiCurrency);
contextBridge.exposeInMainWorld("bukowskiQuotes", bukowskiQuotes);
contextBridge.exposeInMainWorld("bukowskiInvoices", bukowskiInvoices);
contextBridge.exposeInMainWorld("bukowskiTreasury", bukowskiTreasury);
contextBridge.exposeInMainWorld("bukowskiLicenses", bukowskiLicenses);
contextBridge.exposeInMainWorld("bukowskiCatalog", bukowskiCatalog);
contextBridge.exposeInMainWorld("bukowskiRma", bukowskiRma);
