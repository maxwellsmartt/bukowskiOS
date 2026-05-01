import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import type {
  AssistantApprovalPreference,
  AssistantChatAttachmentRow,
  AssistantChatMessageMeta,
  AssistantChatMessageRow,
  AssistantChatMessageSource,
  AssistantChatSnapshot,
  AssistantChatThreadRow,
  AssistantChatThreadState,
  SendAssistantChatTurnCommand,
} from "@contracts";
import {
  createAssistantThread,
  deleteAssistantThread,
  getAssistantChatSnapshot,
  sendAssistantChatTurn,
  setActiveAssistantThread,
  updateAssistantThreadPreferences,
} from "@features/agents/useAgentsData";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";

import { useWorkspace } from "./WorkspaceProvider";

export type AssistantChatSessionState = AssistantChatMessageMeta;

type AssistantChatMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
  state?: AssistantChatSessionState | null;
  source: AssistantChatMessageSource | null;
  attachments: AssistantChatAttachmentRow[];
  createdAt: number;
  updatedAt: number;
};

export type AssistantChatSession = {
  id: string;
  title: string;
  contextKey: string;
  contextLabel: string;
  createdAt: number;
  updatedAt: number;
  summaryText: string;
  preferredApprovalMode: AssistantApprovalPreference;
  threadState: AssistantChatThreadState;
  lastErrorSummary: string | null;
  lastIntent: string | null;
  lastRoutedAgentId: string | null;
  messages: AssistantChatMessage[];
  latestState: AssistantChatSessionState | null;
};

type AssistantChatContextValue = {
  isOpen: boolean;
  isHydrated: boolean;
  activeSession: AssistantChatSession;
  sessions: AssistantChatSession[];
  compareTrayVisible: boolean;
  workspaceId: string;
  isWorkspaceReady: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  refresh: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionApprovalMode: (sessionId: string, preferredApprovalMode: AssistantApprovalPreference) => Promise<void>;
  sendTurn: (input: SendAssistantChatTurnCommand) => Promise<void>;
  setCompareTrayVisible: (visible: boolean) => void;
};

const AssistantChatContext = createContext<AssistantChatContextValue | null>(null);

const fallbackWelcomeBody =
  "Supervisor ready. Ask for context, routing, or a draft run. Nothing touches the command layer from chat without review.";

const resolveContextLabel = (pathname: string) => {
  if (pathname.startsWith("/agents")) {
    return "Agents";
  }

  if (pathname.startsWith("/finance")) {
    return "Finance";
  }

  if (pathname.startsWith("/projects/")) {
    return "Project";
  }

  return "Assets";
};

const buildFallbackSession = (pathname: string): AssistantChatSession => ({
  id: "assistant-fallback-thread",
  title: "New thread",
  contextKey: pathname,
  contextLabel: resolveContextLabel(pathname),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  summaryText: "",
  preferredApprovalMode: "supervised",
  threadState: "idle",
  lastErrorSummary: null,
  lastIntent: null,
  lastRoutedAgentId: null,
  latestState: null,
  messages: [
    {
      id: "assistant-fallback-welcome",
      role: "assistant",
      body: fallbackWelcomeBody,
      state: null,
      source: null,
      attachments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
});

const parseTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const deriveFallbackState = (thread: AssistantChatThreadRow): AssistantChatSessionState | null => {
  if (thread.state === "idle" || thread.state === "completed") {
    return null;
  }

  if (thread.state === "pending" || thread.state === "streaming") {
    return {
      tone: "sending",
      label: "Supervisor reviewing request",
      body: "Routing intent and preparing a supervised response. No changes have been made.",
      routedAgentId: thread.lastRoutedAgentId,
      routedAgentName: "Supervisor Agent",
      routedAgentRole: "Supervisor Agent",
      intentLabel: thread.lastIntent ?? "Pending classification",
      commandStateLabel: "No changes applied",
    };
  }

  return {
    tone: "error",
    label: "Routing unavailable",
    body: thread.lastErrorSummary ?? "This conversation could not be completed.",
    routedAgentId: thread.lastRoutedAgentId,
    routedAgentName: "Supervisor Agent",
    routedAgentRole: "Supervisor Agent",
    intentLabel: thread.lastIntent ?? "Routing unavailable",
    commandStateLabel: "No changes applied",
  };
};

const deriveLatestState = (messages: AssistantChatMessageRow[], thread: AssistantChatThreadRow) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "assistant" && message.meta) {
      return message.meta;
    }
  }

  return deriveFallbackState(thread);
};

const normalizeThread = (thread: AssistantChatThreadRow): AssistantChatSession => {
  const latestState = deriveLatestState(thread.messages, thread);

  return {
    id: thread.id,
    title: thread.title,
    contextKey: thread.contextKey,
    contextLabel: thread.contextLabel,
    createdAt: parseTimestamp(thread.createdAt),
    updatedAt: parseTimestamp(thread.updatedAt),
    summaryText: thread.summaryText,
    preferredApprovalMode: thread.preferredApprovalMode,
    threadState: thread.state,
    lastErrorSummary: thread.lastErrorSummary,
    lastIntent: thread.lastIntent,
    lastRoutedAgentId: thread.lastRoutedAgentId,
    latestState,
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      body: message.body,
      state: message.meta,
      source: message.source,
      attachments: message.attachments,
      createdAt: parseTimestamp(message.createdAt),
      updatedAt: parseTimestamp(message.updatedAt),
    })),
  };
};

export const AssistantChatProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [compareTrayVisible, setCompareTrayVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<AssistantChatSnapshot | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const ensureInitialThread = useCallback(async () => {
    if (!isWorkspaceReady) {
      return null;
    }

    const currentSnapshot = await getAssistantChatSnapshot();

    if (currentSnapshot.threads.length) {
      setSnapshot(currentSnapshot);
      return currentSnapshot;
    }

    const created = await createAssistantThread({
      commandId: `cmd-thread-${Date.now().toString(36)}`,
      workspaceId: activeWorkspaceId,
      contextKey: location.pathname,
      contextLabel: resolveContextLabel(location.pathname),
    });
    setSnapshot(created);
    return created;
  }, [activeWorkspaceId, isWorkspaceReady, location.pathname]);

  const refresh = useCallback(async () => {
    const nextSnapshot = await ensureInitialThread();

    if (!nextSnapshot) {
      return;
    }

    setSnapshot(nextSnapshot);
    setIsHydrated(true);
  }, [ensureInitialThread]);

  useEffect(() => {
    setSnapshot(null);
    setIsHydrated(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasLiveWork = snapshot?.threads.some((thread) => thread.state === "pending" || thread.state === "streaming") ?? false;

  useVisiblePolling(
    () => {
      void refresh();
    },
    { enabled: hasLiveWork, intervalMs: 1500 },
  );

  const sessions = useMemo(() => {
    const rows = snapshot?.threads.map(normalizeThread) ?? [];
    return rows.length ? rows : [buildFallbackSession(location.pathname)];
  }, [location.pathname, snapshot]);

  const activeSession = useMemo(() => {
    const activeThreadId = snapshot?.activeThreadId;
    return sessions.find((session) => session.id === activeThreadId) ?? sessions[0] ?? buildFallbackSession(location.pathname);
  }, [location.pathname, sessions, snapshot?.activeThreadId]);

  const value = useMemo<AssistantChatContextValue>(
    () => ({
      isOpen,
      isHydrated,
      activeSession,
      sessions,
      compareTrayVisible,
      workspaceId: activeWorkspaceId,
      isWorkspaceReady,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((current) => !current),
      refresh,
      createSession: async () => {
        if (!isWorkspaceReady) {
          return;
        }

        const nextSnapshot = await createAssistantThread({
          commandId: `cmd-thread-${Date.now().toString(36)}`,
          workspaceId: activeWorkspaceId,
          contextKey: location.pathname,
          contextLabel: resolveContextLabel(location.pathname),
        });
        setSnapshot(nextSnapshot);
        setIsHydrated(true);
        setIsOpen(true);
      },
      selectSession: async (sessionId: string) => {
        if (!isWorkspaceReady) {
          return;
        }

        const nextSnapshot = await setActiveAssistantThread({
          commandId: `cmd-thread-active-${Date.now().toString(36)}`,
          workspaceId: activeWorkspaceId,
          threadId: sessionId,
        });
        setSnapshot(nextSnapshot);
        setIsHydrated(true);
        setIsOpen(true);
      },
      deleteSession: async (sessionId: string) => {
        if (!isWorkspaceReady) {
          return;
        }

        const nextSnapshot = await deleteAssistantThread({
          commandId: `cmd-thread-delete-${Date.now().toString(36)}`,
          workspaceId: activeWorkspaceId,
          threadId: sessionId,
        });
        setSnapshot(nextSnapshot);
        setIsHydrated(true);
      },
      updateSessionApprovalMode: async (sessionId: string, preferredApprovalMode: AssistantApprovalPreference) => {
        if (!isWorkspaceReady) {
          return;
        }

        const nextSnapshot = await updateAssistantThreadPreferences({
          commandId: `cmd-thread-preferences-${Date.now().toString(36)}`,
          workspaceId: activeWorkspaceId,
          threadId: sessionId,
          preferredApprovalMode,
        });
        setSnapshot(nextSnapshot);
        setIsHydrated(true);
      },
      sendTurn: async (input: SendAssistantChatTurnCommand) => {
        const nextSnapshot = await sendAssistantChatTurn(input);
        setSnapshot(nextSnapshot);
        setIsHydrated(true);
      },
      setCompareTrayVisible,
    }),
    [
      activeSession,
      activeWorkspaceId,
      compareTrayVisible,
      isHydrated,
      isOpen,
      isWorkspaceReady,
      location.pathname,
      refresh,
      sessions,
    ],
  );

  return <AssistantChatContext.Provider value={value}>{children}</AssistantChatContext.Provider>;
};

export const useAssistantChat = () => {
  const value = useContext(AssistantChatContext);

  if (!value) {
    throw new Error("useAssistantChat must be used within AssistantChatProvider");
  }

  return value;
};
