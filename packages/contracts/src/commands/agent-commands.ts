import type {
  AgentApprovalMode,
  AssistantApprovalPreference,
  AgentRunApprovalDecision,
  AgentRunApprovalScope,
  AgentRunStatus,
  AgentStatus,
  AIProviderStatus,
} from "../queries/agent-queries";

export type AgentEditorInput = {
  workspaceId: string;
  agentId: string;
  displayName: string;
  emoji?: string;
  modelKey: string;
  role: string;
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
};

export type AssistantGatewayAttachment = {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type AssistantGatewayRequest = {
  commandId: string;
  workspaceId: string;
  threadId: string;
  message: string;
  attachments?: AssistantGatewayAttachment[];
  context: AIGatewayToolContext;
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
  preferredApprovalMode: AssistantApprovalPreference;
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

export type SaveAIProviderConfigCommand = {
  commandId: string;
  workspaceId: string;
  providerKey: string;
  enabled: boolean;
  apiKey?: string;
  clearStoredKey?: boolean;
  baseUrl?: string;
  defaultModelKey: string;
  timeoutMs: number;
  retryCount: number;
};

export type TestAIProviderConnectionCommand = {
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
  supervisorReply: string;
  requiresApproval: boolean;
};

export type AIProviderMutationResult = {
  providerKey: string;
  status: AIProviderStatus;
  summary: string;
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
};
