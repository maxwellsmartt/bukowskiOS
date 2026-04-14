export type AgentStatus = "active" | "paused";

export type AgentApprovalMode = "auto" | "supervised" | "needs_approval";

export type AssistantApprovalPreference = "supervised" | "needs_approval" | "unsupervised";

export type AgentRunStatus = "queued" | "routing" | "running" | "needs_approval" | "approved" | "denied" | "done" | "failed" | "paused";

export type AgentRunApprovalDecision = "pending" | "approved" | "approved_for_session" | "denied";

export type AgentRunApprovalScope = "run" | "session";

export type AIProviderStatus = "not_configured" | "configured" | "testing" | "healthy" | "invalid_key" | "unavailable";

export type AssistantChatThreadState =
  | "idle"
  | "pending"
  | "streaming"
  | "completed"
  | "needs_configuration"
  | "provider_error"
  | "tool_error"
  | "structured_error"
  | "interrupted";

export type AssistantChatMessageState = "draft" | "pending" | "sent" | "completed" | "error";

export type AssistantChatAttachmentStatus = "available" | "missing" | "deleted" | "cleanup_pending";

export type AssistantChatMessageMeta = {
  tone: "sending" | "routed" | "approval" | "error";
  label: string;
  body: string;
  routedAgentId: string | null;
  routedAgentName: string;
  routedAgentRole: string | null;
  intentLabel: string;
  commandStateLabel: string;
  toolLabel?: string;
  draftRunId?: string | null;
  approvalDecision?: AgentRunApprovalDecision | null;
  approvalScope?: AgentRunApprovalScope | null;
  approvalReason?: string | null;
};

export type AssistantChatAttachmentRow = {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  status: AssistantChatAttachmentStatus;
};

export type AssistantChatMessageRow = {
  id: string;
  role: "assistant" | "user";
  body: string;
  state: AssistantChatMessageState;
  meta: AssistantChatMessageMeta | null;
  attachments: AssistantChatAttachmentRow[];
  createdAt: string;
  updatedAt: string;
};

export type AssistantChatThreadRow = {
  id: string;
  title: string;
  contextKey: string;
  contextLabel: string;
  summaryText: string;
  preferredApprovalMode: AssistantApprovalPreference;
  state: AssistantChatThreadState;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  lastRoutedAgentId: string | null;
  lastIntent: string | null;
  createdAt: string;
  updatedAt: string;
  messages: AssistantChatMessageRow[];
};

export type AssistantChatSnapshot = {
  activeThreadId: string | null;
  threads: AssistantChatThreadRow[];
};

export type AgentGraphNode = {
  id: string;
  agentId: string;
  displayName: string;
  emoji: string;
  role: string;
  mission: string;
  domain: string;
  status: AgentStatus;
  operationalState: "idle" | "working" | "not_working";
  secondaryLabel: string;
  isSupervisor: boolean;
};

export type AgentRosterRow = {
  id: string;
  agentId: string;
  displayName: string;
  emoji: string;
  role: string;
  mission: string;
  domain: string;
  providerKey: string;
  status: AgentStatus;
  operationalState: "idle" | "working" | "not_working";
  modelLabel: string;
  approvalMode: AgentApprovalMode;
  toolsSummary: string;
  domainsSummary: string;
  notes: string;
  isSupervisor: boolean;
};

export type AgentDetailSnapshot = {
  agent: AgentRosterRow | null;
  tools: string[];
  domains: string[];
  recentRuns: AgentRunRow[];
};

export type AgentRunRow = {
  id: string;
  agentId: string | null;
  threadId: string | null;
  title: string;
  status: AgentRunStatus;
  summary: string;
  agentDisplayName: string;
  approvalMode: AgentApprovalMode;
  approvalRequired: boolean;
  approvalDecision: AgentRunApprovalDecision | null;
  approvalScope: AgentRunApprovalScope | null;
  approvalReason: string | null;
  createdAtLabel: string;
  updatedAtLabel: string;
};

export type AgentActivityRow = {
  id: string;
  agentId: string | null;
  title: string;
  body: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
  agentDisplayName: string;
  timestampLabel: string;
};

export type AgentModelRow = {
  id: string;
  providerKey: string;
  label: string;
  status: AIProviderStatus;
  enabled: boolean;
  isActiveProvider: boolean;
  supportsLiveRequests: boolean;
  hasStoredSecret: boolean;
  defaultModelKey: string;
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  lastTestedAtLabel: string;
  lastSuccessAtLabel: string;
  lastErrorSummary: string;
  assignedAgents: string[];
  assignedModels: string[];
  notes: string;
};

export type AgentModelAssignmentRow = {
  agentId: string;
  displayName: string;
  providerKey: string;
  providerLabel: string;
  modelKey: string;
  modelLabel: string;
  status: AgentStatus;
  isSupervisor: boolean;
};

export type AgentModelsSnapshot = {
  providers: AgentModelRow[];
  assignments: AgentModelAssignmentRow[];
  summary: {
    activeProviders: string;
    configuredProviders: string;
    healthyProviders: string;
    assignedAgents: string;
  };
};

export type AgentConnectorRow = {
  id: string;
  connectorKey: string;
  label: string;
  status: "configured" | "not_configured" | "disabled";
  capability: string;
  notes: string;
};

export type MissionControlHealthSnapshot = {
  activeAgents: string;
  pausedAgents: string;
  recentRuns: string;
  connectorsConfigured: string;
  modelsAssigned: string;
};

export type MissionControlSnapshot = {
  supervisor: AgentGraphNode | null;
  subagents: AgentGraphNode[];
  queue: AgentRunRow[];
  activity: AgentActivityRow[];
  health: MissionControlHealthSnapshot;
  modelSummary: AgentModelRow[];
  connectorSummary: AgentConnectorRow[];
};
