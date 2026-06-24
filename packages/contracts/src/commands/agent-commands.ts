import type {
  AgentApprovalMode,
  AssistantActionLink,
  AssistantApprovalPreference,
  AssistantReasoningEffort,
  AssistantChatMessageSource,
  AssistantOperationalReceipt,
  AssistantPermissionRequest,
  AgentRunApprovalDecision,
  AgentRunApprovalScope,
  AgentRunStatus,
  AgentStatus,
  AIProviderStatus,
} from "../queries/agent-queries";
import type { AgentNotificationIntent } from "../queries/notification-queries";

export type AgentEditorInput = {
  workspaceId: string;
  agentId: string;
  displayName: string;
  emoji?: string;
  modelKey: string;
  role: string;
  mission: string;
  domain: string;
  allowedTools: string[];
  allowedDomains: string[];
  status: AgentStatus;
  approvalMode: AgentApprovalMode;
  notes?: string;
};

export type CreateAgentCommand = AgentEditorInput & {
  commandId: string;
};

export type UpdateAgentCommand = AgentEditorInput & {
  commandId: string;
  id: string;
};

export type SetAgentStatusCommand = {
  commandId: string;
  workspaceId: string;
  id: string;
  status: AgentStatus;
};

export type SetAgentApprovalModeCommand = {
  commandId: string;
  workspaceId: string;
  id: string;
  approvalMode: AgentApprovalMode;
};

export type CreateDraftRunFromChatCommand = {
  commandId: string;
  workspaceId: string;
  message: string;
  routeHint?: string;
  activePath?: string;
};

export type AIGatewayToolContext = {
  workspaceId: string;
  activePath?: string;
  activeProjectId?: string | null;
  currentView?: string | null;
  activeFilters?: Record<string, string>;
  requestedApprovalMode?: AssistantApprovalPreference;
  /** Per-thread model override chosen in the chat header (provider:model). */
  requestedModelKey?: string | null;
  /** Per-thread reasoning effort chosen in the chat header. */
  requestedReasoningEffort?: AssistantReasoningEffort | null;
  sourceConnectorKey?: string | null;
  sourceChannelId?: string | null;
  sourceExternalMessageId?: string | null;
  sourceActorUserId?: string | null;
  /** Main-process resolved permissions for the authenticated actor. Never trust renderer-supplied values. */
  userPermissions?: string[];
  correlationId?: string | null;
  /** Current chat thread, so document tools can scope to its attachments. */
  threadId?: string | null;
  /**
   * Documents attached to the current turn, pre-extracted by the gateway so
   * synchronous tools can read them. Images carry no text (the model sees them
   * directly); CSV/XLSX/PDF carry extracted text/rows.
   */
  attachedDocuments?: Array<{
    name: string;
    kind: "csv" | "xlsx" | "pdf" | "text" | "image" | "unknown";
    mimeType: string;
    text: string;
    rows?: string[][];
    rowCount: number;
    truncated: boolean;
  }>;
};

export type AssistantGatewayAttachment = {
  id: string;
  kind: "image" | "document";
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type TranscribeAssistantAudioCommand = {
  commandId: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  source: "desktop" | "telegram";
};

export type AssistantAudioTranscriptionResult = {
  text: string;
  model: string;
  byteSize: number;
};

export type AssistantChatMessageSourceInput = Omit<
  AssistantChatMessageSource,
  "connectorLabel" | "channelLabel" | "actorUserId" | "actorRole" | "externalMessageId" | "correlationId"
> & {
  connectorLabel?: string;
  channelLabel?: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  externalMessageId?: string | null;
  correlationId?: string | null;
};

export type AssistantGatewayRequest = {
  commandId: string;
  workspaceId: string;
  threadId: string;
  message: string;
  attachments?: AssistantGatewayAttachment[];
  context: AIGatewayToolContext;
  source?: AssistantChatMessageSourceInput;
};

export type CreateAssistantThreadCommand = {
  commandId: string;
  workspaceId: string;
  contextKey: string;
  contextLabel: string;
};

export type DeleteAssistantThreadCommand = {
  commandId: string;
  workspaceId: string;
  threadId: string;
};

export type SetActiveAssistantThreadCommand = {
  commandId: string;
  workspaceId: string;
  threadId: string;
};

export type UpdateAssistantThreadPreferencesCommand = {
  commandId: string;
  workspaceId: string;
  threadId: string;
  preferredApprovalMode?: AssistantApprovalPreference;
  preferredModelKey?: string | null;
  preferredReasoningEffort?: AssistantReasoningEffort | null;
};

export type RenameAssistantThreadCommand = {
  commandId: string;
  workspaceId: string;
  threadId: string;
  title: string;
};

export type RecordRuntimeErrorCommand = {
  sourceKind: "main" | "renderer" | "webcontents";
  processLabel: string;
  errorName: string;
  message: string;
  stack?: string | null;
  severity?: "low" | "medium" | "critical";
  context?: Record<string, unknown> | null;
  threadId?: string | null;
};

export type SendAssistantChatTurnCommand = AssistantGatewayRequest;

export type ReviewAgentRunDecision = "approve" | "deny" | "approve_for_session";

export type ReviewAgentRunCommand = {
  commandId: string;
  workspaceId: string;
  runId: string;
  decision: ReviewAgentRunDecision;
};

export type RequestAgentPermissionCommand = {
  commandId: string;
  workspaceId: string;
  permission: string;
};

export type RequestAgentPermissionResult = {
  /** How many workspace admins were notified of the request. */
  notifiedAdmins: number;
  /** True when an identical pending request already existed (no new notice sent). */
  alreadyRequested: boolean;
  /** Human label for the requested permission. */
  label: string;
};

export type SaveAIProviderConfigCommand = {
  commandId: string;
  workspaceId: string;
  providerKey: string;
  enabled: boolean;
  apiKey?: string;
  clearStoredKey?: boolean;
  baseUrl?: string;
  defaultModelKey: string;
  fallbackModelKey?: string;
  timeoutMs: number;
  retryCount: number;
};

export type TestAIProviderConnectionCommand = {
  workspaceId: string;
  providerKey: string;
};

export type RefreshAIProviderModelsCommand = {
  workspaceId: string;
  providerKey: string;
};

export type AssignAgentModelCommand = {
  commandId: string;
  workspaceId: string;
  agentId: string;
  providerKey: string;
  modelKey: string;
  modelLabel: string;
};

export type AgentMutationResult = {
  agentId: string;
  summary: string;
};

export type DraftRunFromChatResult = {
  runId: string;
  status: AgentRunStatus;
  routedAgentId: string | null;
  routedAgentName: string;
  routedAgentRole?: string | null;
  supervisorReply: string;
  requiresApproval: boolean;
};

export type AIProviderMutationResult = {
  providerKey: string;
  status: AIProviderStatus;
  summary: string;
};

export type SaveConnectorConfigCommand = {
  commandId: string;
  workspaceId: string;
  connectorKey: string;
  enabled: boolean;
  botToken?: string;
  clearStoredSecret?: boolean;
};

export type TestConnectorConnectionCommand = {
  workspaceId: string;
  connectorKey: string;
};

export type CreateConnectorLinkTokenCommand = {
  commandId: string;
  workspaceId: string;
  connectorKey: string;
  userId: string;
  expiresInMinutes?: number;
};

export type ConnectorMutationResult = {
  connectorKey: string;
  status: "configured" | "not_configured" | "disabled";
  summary: string;
  botUsername?: string | null;
  linkToken?: string | null;
};

export type AgentRunReviewResult = {
  runId: string;
  status: AgentRunStatus;
  approvalDecision: AgentRunApprovalDecision;
  approvalScope: AgentRunApprovalScope | null;
  summary: string;
};

export type AIGatewayToolCallTrace = {
  toolName: string;
  status: "completed" | "failed";
  summary: string;
};

export type OrchestrationResult = {
  intent: string;
  targetAgentId: string | null;
  targetAgentName: string;
  confidence: number;
  requiresApproval: boolean;
  toolCallRequested: boolean;
  toolCalls: AIGatewayToolCallTrace[];
  userFacingSummary: string;
  answerKind: "informational" | "draft_run" | "needs_approval" | "error";
  draftRunTitle: string | null;
  draftRunDescription: string | null;
};

export type AssistantGatewayResponse = {
  status:
    | "answered"
    | "draft_created"
    | "needs_configuration"
    | "provider_error"
    | "tool_error"
    | "structured_error";
  stateLabel: string;
  stateBody: string;
  assistantMessage: string;
  routedAgentId: string | null;
  routedAgentName: string;
  routedAgentRole: string | null;
  intentLabel: string;
  commandStateLabel: string;
  draftRunId: string | null;
  approvalDecision?: AgentRunApprovalDecision | null;
  approvalScope?: AgentRunApprovalScope | null;
  approvalReason?: string | null;
  providerKey: string | null;
  modelKey: string | null;
  toolTraces: AIGatewayToolCallTrace[];
  orchestration: OrchestrationResult | null;
  actionLinks?: AssistantActionLink[];
  notificationIntents?: AgentNotificationIntent[];
  operationalReceipt?: AssistantOperationalReceipt | null;
  permissionRequests?: AssistantPermissionRequest[];
};
