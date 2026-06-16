import { useEffect, useState } from "react";

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
  AgentRunReviewResult,
  AgentRosterRow,
  AgentRunRow,
  AssignAgentModelCommand,
  CreateAgentCommand,
  CreateAssistantThreadCommand,
  CreateConnectorLinkTokenCommand,
  CreateDraftRunFromChatCommand,
  DeleteAssistantThreadCommand,
  DraftRunFromChatResult,
  MissionControlSnapshot,
  ReviewAgentRunCommand,
  SaveAIProviderConfigCommand,
  RefreshAIProviderModelsCommand,
  SaveConnectorConfigCommand,
  SendAssistantChatTurnCommand,
  TranscribeAssistantAudioCommand,
  SetActiveAssistantThreadCommand,
  RenameAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  SetAgentApprovalModeCommand,
  SetAgentStatusCommand,
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  UpdateAgentCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const agentsRefreshEvent = "bukowski:agents-changed";

const emptyMissionControlSnapshot: MissionControlSnapshot = {
  supervisor: null,
  subagents: [],
  queue: [],
  activity: [],
  health: {
    activeAgents: "—",
    pausedAgents: "—",
    recentRuns: "—",
    connectorsConfigured: "—",
    modelsAssigned: "—",
  },
  modelSummary: [],
  connectorSummary: [],
};

const emptyAgentModelsSnapshot: AgentModelsSnapshot = {
  providers: [],
  assignments: [],
  summary: {
    activeProviders: "0",
    configuredProviders: "0",
    healthyProviders: "0",
    assignedAgents: "0",
  },
};

const emptyAgentDetailSnapshot: AgentDetailSnapshot = {
  agent: null,
  tools: [],
  domains: [],
  recentRuns: [],
};

const useAgentsRefreshVersion = () => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleRefresh = () => {
      setVersion((current) => current + 1);
    };

    window.addEventListener(agentsRefreshEvent, handleRefresh);
    return () => {
      window.removeEventListener(agentsRefreshEvent, handleRefresh);
    };
  }, []);

  return version;
};

export const notifyAgentsChanged = () => {
  window.dispatchEvent(new Event(agentsRefreshEvent));
};

type AgentWorkspaceQuery = {
  workspaceId?: string;
};

export const useMissionControlSnapshot = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return emptyMissionControlSnapshot;
      }

      return window.bukowskiAgents.getMissionControlSnapshot(query);
    },
    emptyMissionControlSnapshot,
    [refreshVersion, workspaceId],
  );
};

export const useAgentsList = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return [] as AgentRosterRow[];
      }

      return window.bukowskiAgents.getAgentsList(query);
    },
    [] as AgentRosterRow[],
    [refreshVersion, workspaceId],
  );
};

export const useAgentDetail = (agentId: string | null, query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents || !agentId) {
        return emptyAgentDetailSnapshot;
      }

      return window.bukowskiAgents.getAgentDetail(agentId, query);
    },
    emptyAgentDetailSnapshot,
    [agentId, refreshVersion, workspaceId],
  );
};

export const useAgentRuns = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return [] as AgentRunRow[];
      }

      return window.bukowskiAgents.getRunsList(query);
    },
    [] as AgentRunRow[],
    [refreshVersion, workspaceId],
  );
};

export const useAgentModels = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return emptyAgentModelsSnapshot;
      }

      return window.bukowskiAgents.getModelsSnapshot(query);
    },
    emptyAgentModelsSnapshot,
    [refreshVersion, workspaceId],
  );
};

export const useAIProviderConfigs = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return [] as AgentModelRow[];
      }

      return window.bukowskiAgents.getAIProviderConfigs(query);
    },
    [] as AgentModelRow[],
    [refreshVersion, workspaceId],
  );
};

export const useAgentConnectors = (query?: AgentWorkspaceQuery) => {
  const refreshVersion = useAgentsRefreshVersion();
  const workspaceId = query?.workspaceId;

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAgents) {
        return [] as AgentConnectorRow[];
      }

      return window.bukowskiAgents.getConnectorsSnapshot(query);
    },
    [] as AgentConnectorRow[],
    [refreshVersion, workspaceId],
  );
};

export const createAgent = async (input: CreateAgentCommand): Promise<AgentMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.create(input);
  notifyAgentsChanged();
  return result;
};

export const updateAgent = async (input: UpdateAgentCommand): Promise<AgentMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.update(input);
  notifyAgentsChanged();
  return result;
};

export const setAgentStatus = async (input: SetAgentStatusCommand): Promise<AgentMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.setStatus(input);
  notifyAgentsChanged();
  return result;
};

export const setAgentApprovalMode = async (input: SetAgentApprovalModeCommand): Promise<AgentMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.setApprovalMode(input);
  notifyAgentsChanged();
  return result;
};

export const saveAIProviderConfig = async (input: SaveAIProviderConfigCommand): Promise<AIProviderMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.saveAIProviderConfig(input);
  notifyAgentsChanged();
  return result;
};

export const testAIProviderConnection = async (
  input: TestAIProviderConnectionCommand,
): Promise<AIProviderMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.testAIProviderConnection(input);
  notifyAgentsChanged();
  return result;
};

export const refreshAIProviderModels = async (
  input: RefreshAIProviderModelsCommand,
): Promise<AIProviderMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.refreshAIProviderModels(input);
  notifyAgentsChanged();
  return result;
};

export const saveConnectorConfig = async (input: SaveConnectorConfigCommand): Promise<ConnectorMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.saveConnectorConfig(input);
  notifyAgentsChanged();
  return result;
};

export const testConnectorConnection = async (
  input: TestConnectorConnectionCommand,
): Promise<ConnectorMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.testConnectorConnection(input);
  notifyAgentsChanged();
  return result;
};

export const createConnectorLinkToken = async (
  input: CreateConnectorLinkTokenCommand,
): Promise<ConnectorMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.createConnectorLinkToken(input);
  notifyAgentsChanged();
  return result;
};

export const assignAgentModel = async (input: AssignAgentModelCommand): Promise<AgentMutationResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.assignAgentModel(input);
  notifyAgentsChanged();
  return result;
};

export const sendAssistantMessage = async (input: AssistantGatewayRequest): Promise<AssistantGatewayResponse> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.sendAssistantMessage(input);
  notifyAgentsChanged();
  return result;
};

export const getAssistantChatSnapshot = async (): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  return window.bukowskiAgents.getAssistantChatSnapshot();
};

export const createAssistantThread = async (input: CreateAssistantThreadCommand): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.createAssistantThread(input);
  notifyAgentsChanged();
  return result;
};

export const deleteAssistantThread = async (input: DeleteAssistantThreadCommand): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.deleteAssistantThread(input);
  notifyAgentsChanged();
  return result;
};

export const setActiveAssistantThread = async (input: SetActiveAssistantThreadCommand): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.setActiveAssistantThread(input);
  notifyAgentsChanged();
  return result;
};

export const updateAssistantThreadPreferences = async (
  input: UpdateAssistantThreadPreferencesCommand,
): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.updateAssistantThreadPreferences(input);
  notifyAgentsChanged();
  return result;
};

export const renameAssistantThread = async (
  input: RenameAssistantThreadCommand,
): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.renameAssistantThread(input);
  notifyAgentsChanged();
  return result;
};

export const sendAssistantChatTurn = async (input: SendAssistantChatTurnCommand): Promise<AssistantChatSnapshot> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.sendAssistantChatTurn(input);
  notifyAgentsChanged();
  return result;
};

export const transcribeAssistantAudio = async (
  input: TranscribeAssistantAudioCommand,
): Promise<AssistantAudioTranscriptionResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  return window.bukowskiAgents.transcribeAudio(input);
};

export const reviewAgentRun = async (input: ReviewAgentRunCommand): Promise<AgentRunReviewResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.reviewRun(input);
  notifyAgentsChanged();
  return result;
};

export const createDraftRunFromChat = async (
  input: CreateDraftRunFromChatCommand,
): Promise<DraftRunFromChatResult> => {
  if (!window.bukowskiAgents) {
    throw new Error("Agents bridge unavailable");
  }

  const result = await window.bukowskiAgents.createDraftRunFromChat(input);
  notifyAgentsChanged();
  return result;
};
