import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mic,
  PanelLeft,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import type { AssistantChatSession, AssistantChatSessionState } from "@app/providers/AssistantChatContext";
import type { AssistantApprovalPreference, AssistantChatMessageMeta, AssistantChatSnapshot, AssistantGatewayAttachment, AssistantReasoningEffort } from "@contracts";

import { useAssistantChat } from "@app/providers/AssistantChatContext";
import { useSession } from "@app/providers/SessionProvider";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { requestAgentPermission, reviewAgentRun, transcribeAssistantAudio, useAgentModels } from "@features/agents/useAgentsData";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "@shared/lib/preferences";

const reasoningOptions: AssistantReasoningEffort[] = ["low", "medium", "high"];
const approvalOptions: Array<{ labelKey: string; value: AssistantApprovalPreference }> = [
  { labelKey: "assistantChat.approvalMode.supervised", value: "supervised" },
  { labelKey: "assistantChat.approvalMode.needs_approval", value: "needs_approval" },
  { labelKey: "assistantChat.approvalMode.unsupervised", value: "unsupervised" },
];
type ActiveSelector = "model" | "reasoning" | "approval" | null;
type ThreadSourceFilter = "app" | "telegram" | "all";
type ThreadMenuState = {
  sessionId: string;
  top: number;
  left: number;
} | null;
type ChatPanelResizeState = {
  maxScale: number;
  startHeight: number;
  startScale: number;
  startWidth: number;
  startX: number;
  startY: number;
};

const threadSourceFilterOptions: Array<{ label: string; value: ThreadSourceFilter }> = [
  { label: "App", value: "app" },
  { label: "Telegram", value: "telegram" },
  { label: "All", value: "all" },
];

type OptimisticTurn = {
  threadId: string;
  userMessage: {
    id: string;
    role: "user";
    body: string;
    source: null;
  };
  state: AssistantChatSessionState;
};

type OptimisticAssistantMessage = {
  threadId: string;
  message: {
    id: string;
    role: "assistant";
    body: string;
    state: AssistantChatSessionState;
  };
};

const maxImageAttachments = 3;
const maxImageAttachmentBytes = 6 * 1024 * 1024;
const maxDocumentAttachmentBytes = 15 * 1024 * 1024;
const maxVoiceRecordingMs = 90_000;
const voiceWaveformBarCount = 42;
const silentVoiceLevels = Array.from({ length: voiceWaveformBarCount }, () => 0.08);
const transientVoiceErrorMs = 4_500;

const isNoSpeechVoiceError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no speech was detected|no se detect[oó] voz|no speech detected/i.test(message);
};

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The voice recording could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The voice recording could not be read."));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });

const deriveIntentLabel = (pathname: string) => {
  if (pathname.startsWith("/finance")) {
    return "Finance intent classified";
  }

  if (pathname.startsWith("/agents")) {
    return "Agent control intent classified";
  }

  if (pathname.startsWith("/projects/")) {
    return "Project coordination intent classified";
  }

  return "Assets operations intent classified";
};

const formatThreadTimestamp = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))}m`;
  }

  if (diff < day) {
    return `${Math.floor(diff / hour)}h`;
  }

  return `${Math.floor(diff / day)}d`;
};

const formatVoiceDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatAttachmentSummary = (count: number) => (count === 1 ? "Attached 1 file." : `Attached ${count} files.`);

const getSessionSource = (session: AssistantChatSession): "app" | "telegram" => {
  if (session.contextKey.includes("connector=telegram")) {
    return "telegram";
  }

  return session.messages.some((message) => message.source?.connectorKey === "telegram") ? "telegram" : "app";
};

const matchesThreadSourceFilter = (session: AssistantChatSession, filter: ThreadSourceFilter) =>
  filter === "all" || getSessionSource(session) === filter;

const getThreadSourceLabel = (session: AssistantChatSession) => (getSessionSource(session) === "telegram" ? "Telegram" : "App");

const getUserMessageSourceLabel = (source: AssistantChatSession["messages"][number]["source"]) => {
  if (!source) {
    return null;
  }

  if (source.connectorKey === "telegram") {
    return "You via Telegram";
  }

  return source.actorName || source.connectorLabel;
};

const buildUserBubbleMessage = (body: string, attachments: AssistantGatewayAttachment[]) => {
  const trimmedBody = body.trim();

  if (!attachments.length) {
    return trimmedBody;
  }

  const summary = formatAttachmentSummary(attachments.length);
  return trimmedBody ? `${trimmedBody}\n\n${summary}` : summary;
};

const inlineMarkdownTokenPattern = /(\*\*\*[^*\n][\s\S]*?\*\*\*|\*\*[^*\n][\s\S]*?\*\*|__[^_\n][\s\S]*?__|`[^`\n][\s\S]*?`|\*[^*\n][\s\S]*?\*)/g;

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(inlineMarkdownTokenPattern)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }

    const key = `${keyPrefix}-${matchIndex.toString(36)}`;

    if (token.startsWith("***") && token.endsWith("***")) {
      const value = token.slice(3, -3).trim();
      nodes.push(
        <strong key={key}>
          <em>{value}</em>
        </strong>,
      );
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={key}>{token.slice(2, -2).trim()}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1).trim()}</em>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(token);
    }

    cursor = start + token.length;
    matchIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length ? nodes : [text];
};

const renderParagraphBody = (value: string, keyPrefix: string) =>
  value.split("\n").map((line, index, lines) => (
    <Fragment key={`${keyPrefix}-line-${index.toString(36)}`}>
      {renderInlineMarkdown(line, `${keyPrefix}-inline-${index.toString(36)}`)}
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));

const renderMessageMarkdown = (body: string) => {
  const normalized = body.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return null;
  }

  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim().length > 0);

  return blocks.map((block, blockIndex) => {
    const trimmedBlock = block.trim();
    const headingMatch = trimmedBlock.match(/^(#{1,6})\s+(.+)$/s);

    if (headingMatch) {
      return (
        <div
          key={`markdown-heading-${blockIndex.toString(36)}`}
          className={`assistant-chat-markdown-heading assistant-chat-markdown-heading-${headingMatch[1].length}`}
        >
          {renderInlineMarkdown(headingMatch[2].trim(), `heading-${blockIndex.toString(36)}`)}
        </div>
      );
    }

    const lines = trimmedBlock.split("\n");
    const orderedList = lines.every((line) => /^\d+\.\s+/.test(line.trim()));
    const unorderedList = lines.every((line) => /^[-*]\s+/.test(line.trim()));

    if (orderedList) {
      return (
        <ol key={`markdown-ordered-${blockIndex.toString(36)}`} className="assistant-chat-markdown-list assistant-chat-markdown-list-ordered">
          {lines.map((line, itemIndex) => (
            <li key={`ordered-${blockIndex.toString(36)}-${itemIndex.toString(36)}`}>
              {renderInlineMarkdown(line.trim().replace(/^\d+\.\s+/, ""), `ordered-${blockIndex.toString(36)}-${itemIndex.toString(36)}`)}
            </li>
          ))}
        </ol>
      );
    }

    if (unorderedList) {
      return (
        <ul key={`markdown-unordered-${blockIndex.toString(36)}`} className="assistant-chat-markdown-list assistant-chat-markdown-list-unordered">
          {lines.map((line, itemIndex) => (
            <li key={`unordered-${blockIndex.toString(36)}-${itemIndex.toString(36)}`}>
              {renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""), `unordered-${blockIndex.toString(36)}-${itemIndex.toString(36)}`)}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={`markdown-paragraph-${blockIndex.toString(36)}`} className="assistant-chat-markdown-paragraph">
        {renderParagraphBody(trimmedBlock, `paragraph-${blockIndex.toString(36)}`)}
      </p>
    );
  });
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error(`I could not read ${file.name}.`));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`I could not convert ${file.name} into a usable image.`));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });

const DOC_EXTENSIONS = /\.(csv|xlsx|xls|pdf|txt)$/i;
const DOC_MIME = /(csv|spreadsheet|excel|pdf|text\/plain)/i;
const isSupportedAttachment = (file: File) =>
  file.type.startsWith("image/") || DOC_MIME.test(file.type) || DOC_EXTENSIONS.test(file.name);

const toChatAttachment = async (file: File): Promise<AssistantGatewayAttachment> => {
  const isImage = file.type.startsWith("image/");
  if (!isSupportedAttachment(file)) {
    throw new Error(`${file.name}: only images, CSV, XLSX, PDF or text files are supported.`);
  }
  const limit = isImage ? maxImageAttachmentBytes : maxDocumentAttachmentBytes;
  if (file.size > limit) {
    throw new Error(`${file.name} exceeds the ${Math.round(limit / (1024 * 1024))} MB limit.`);
  }

  return {
    id: `attachment-${file.name}-${file.lastModified.toString(36)}-${file.size.toString(36)}`,
    kind: isImage ? "image" : "document",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl: await readFileAsDataUrl(file),
  };
};

const getLatestAssistantMeta = (snapshot: AssistantChatSnapshot, threadId: string): AssistantChatMessageMeta | null => {
  const thread = snapshot.threads.find((item) => item.id === threadId);
  if (!thread) {
    return null;
  }

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === "assistant" && message.meta) {
      return message.meta;
    }
  }

  return null;
};

const buildAgentCompletionNotification = (meta: AssistantChatMessageMeta | null, fallbackPath: string, threadId: string) => {
  if (!meta) {
    return {
      title: "Agent update ready",
      body: "Your assistant response is ready in BukowskiOS.",
      linkTo: fallbackPath,
      sourceRef: { threadId },
    };
  }

  const firstActionLink = meta.actionLinks?.[0] ?? null;
  const needsReview = Boolean(meta.draftRunId) || meta.tone === "approval";
  const linkTo = firstActionLink?.path ?? (needsReview ? "/agents/runs" : fallbackPath);

  if (meta.tone === "error") {
    return {
      title: `${meta.routedAgentName} needs attention`,
      body: meta.body || meta.commandStateLabel || "The agent could not complete the request.",
      linkTo,
      sourceRef: {
        threadId,
        draftRunId: meta.draftRunId ?? null,
        routedAgentId: meta.routedAgentId,
        state: "error",
      },
    };
  }

  if (needsReview) {
    return {
      title: "Agent draft ready for review",
      body: meta.body || meta.commandStateLabel || "A supervised agent run is waiting for your review.",
      linkTo,
      sourceRef: {
        threadId,
        draftRunId: meta.draftRunId ?? null,
        routedAgentId: meta.routedAgentId,
        state: "approval",
      },
    };
  }

  if (firstActionLink) {
    return {
      title: `${meta.routedAgentName} finished an operation`,
      body: `${firstActionLink.label}${meta.toolLabel ? ` · ${meta.toolLabel}` : ""}`,
      linkTo,
      sourceRef: {
        threadId,
        routedAgentId: meta.routedAgentId,
        actionLink: firstActionLink,
      },
    };
  }

  return {
    title: `${meta.routedAgentName} update ready`,
    body: meta.body || meta.commandStateLabel || "The assistant response is ready.",
    linkTo,
    sourceRef: {
      threadId,
      routedAgentId: meta.routedAgentId,
    },
  };
};

const buildStateActions = (state: AssistantChatSessionState | null, t: ReturnType<typeof useTranslation>["t"]) => {
  if (!state) {
    return [];
  }

  const actions: Array<{ label: string; to: string }> = [];
  const seenPaths = new Set<string>();

  for (const link of state.actionLinks ?? []) {
    if (!link.path || seenPaths.has(link.path)) {
      continue;
    }

    seenPaths.add(link.path);
    actions.push({ label: link.label, to: link.path });
  }

  if (state.tone !== "sending") {
    seenPaths.add("/agents/runs");
    actions.push({ label: t("assistantChat.actions.openRuns"), to: "/agents/runs" });
  }

  if (state.routedAgentId) {
    const agentPath = `/agents/mission-control?agent=${encodeURIComponent(state.routedAgentId)}`;
    if (seenPaths.has(agentPath)) {
      return actions;
    }

    seenPaths.add(agentPath);
    actions.push({
      label: t("assistantChat.actions.viewAgent"),
      to: agentPath,
    });
  }

  return actions;
};

const actionEntityLabels: Record<NonNullable<AssistantChatSessionState["actionLinks"]>[number]["entityType"], string> = {
  asset: "Asset",
  incident: "Incident",
  packing_slip: "Packing slip",
  project: "Project",
  quote: "Quote",
  rma: "RMA",
};

const buildActionResultSummary = (state: AssistantChatSessionState, t: ReturnType<typeof useTranslation>["t"]) => {
  const links = state.actionLinks ?? [];
  const labels = Array.from(
    new Set(links.map((link) => t(`assistantChat.actionEntities.${link.entityType}`, { defaultValue: actionEntityLabels[link.entityType] ?? t("assistantChat.actionEntities.item") }))),
  );

  if (!labels.length) {
    return t("assistantChat.actionCompleted");
  }

  if (labels.length === 1) {
    return t("assistantChat.singleEntityReady", { entity: labels[0] });
  }

  return t("assistantChat.multipleEntitiesReady", { entities: labels.slice(0, -1).join(", "), last: labels.at(-1) });
};

const buildOperationalReceiptRows = (state: AssistantChatSessionState | null, limit?: number) => {
  const receipt = state?.operationalReceipt;

  if (!receipt) {
    return [];
  }

  const rows = [...receipt.blocked, ...receipt.pending, ...receipt.completed];
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
};

const findLatestOperationalReceiptState = (session: AssistantChatSession | null) => {
  if (!session) {
    return null;
  }

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const state = session.messages[index]?.state ?? null;
    if (state?.operationalReceipt) {
      return state;
    }
  }

  return session.latestState?.operationalReceipt ? session.latestState : null;
};

const resolveApprovalToneClass = (decision: AssistantChatSessionState["approvalDecision"]) => {
  if (decision === "denied") {
    return "is-denied";
  }

  if (decision === "approved_for_session") {
    return "is-session";
  }

  return "is-approved";
};

const resolveApprovalSummary = (state: AssistantChatSessionState, t: ReturnType<typeof useTranslation>["t"]) => {
  if (state.approvalDecision === "denied") {
    return t("assistantChat.approvalResult.denied");
  }

  if (state.approvalDecision === "approved_for_session") {
    return t("assistantChat.approvalResult.approvedForSession");
  }

  return t("assistantChat.approvalResult.approved");
};

const buildOptimisticSession = (
  session: AssistantChatSession,
  optimisticTurn: OptimisticTurn | null,
  optimisticAssistantMessage: OptimisticAssistantMessage | null,
): AssistantChatSession => {
  if ((!optimisticTurn || optimisticTurn.threadId !== session.id) && (!optimisticAssistantMessage || optimisticAssistantMessage.threadId !== session.id)) {
    return session;
  }

  const nextMessages = [...session.messages];

  if (optimisticTurn && optimisticTurn.threadId === session.id) {
    nextMessages.push({
      ...optimisticTurn.userMessage,
      state: null,
      attachments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  if (optimisticAssistantMessage && optimisticAssistantMessage.threadId === session.id) {
    nextMessages.push({
      ...optimisticAssistantMessage.message,
      source: null,
      attachments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return {
    ...session,
    updatedAt: Date.now(),
    latestState: optimisticAssistantMessage?.message.state ?? optimisticTurn?.state ?? session.latestState,
    messages: nextMessages,
  };
};

export const GlobalAssistantChat = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { compatibleItems } = useCompareTray();
  const { agentUnreadCount, applyAgentNotificationIntents, createNotification } = useNotifications();
  const {
    activeSession,
    compareTrayVisible,
    createSession,
    close,
    deleteSession,
    isOpen,
    isWorkspaceReady,
    open,
    sendTurn,
    refresh,
    renameSession,
    selectSession,
    sessions,
    setCompareTrayVisible,
    updateSessionPreferences,
    toggle,
    workspaceId,
  } = useAssistantChat();
  const { user } = useSession();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  // selectedModel holds a real "provider:model" key (or "" = agent default).
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoning, setSelectedReasoning] = useState<AssistantReasoningEffort>("medium");
  const [selectedApproval, setSelectedApproval] = useState<AssistantApprovalPreference>("unsupervised");
  const { data: agentModelsData } = useAgentModels({ workspaceId });
  const modelChoices = useMemo<Array<{ modelKey: string; label: string }>>(() => {
    const choices: Array<{ modelKey: string; label: string }> = [];
    const seen = new Set<string>();
    for (const provider of agentModelsData?.providers ?? []) {
      if (!provider.enabled || !provider.supportsLiveRequests) {
        continue;
      }
      for (const option of provider.modelOptions) {
        const modelKey = option.key.includes(":") ? option.key : `${provider.providerKey}:${option.key}`;
        if (seen.has(modelKey)) {
          continue;
        }
        seen.add(modelKey);
        choices.push({ modelKey, label: option.label });
      }
    }
    return choices;
  }, [agentModelsData]);
  // When a model is selected, always show *something* for it — its catalog
  // label, or the key itself if the model list has not loaded yet (or no longer
  // lists it). Falling through to undefined made the header flash back to
  // "Modelo del agente" even though the choice was set and persisted.
  const selectedModelLabel = selectedModel
    ? modelChoices.find((choice) => choice.modelKey === selectedModel)?.label ?? selectedModel
    : undefined;
  // The supervisor's real (possibly user-renamed) name, so the thinking/pending
  // state shows it instead of the generic "Supervisor Agent".
  const supervisorName = useMemo(
    () => agentModelsData?.assignments?.find((assignment) => assignment.isSupervisor)?.displayName?.trim() || t("agents.runs.supervisorAgent"),
    [agentModelsData, t],
  );
  const [panelScale, setPanelScale] = useState(1);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [attachments, setAttachments] = useState<AssistantGatewayAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [activeSelector, setActiveSelector] = useState<ActiveSelector>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    readJsonPreference<boolean>(uiPreferenceKeys.assistantChatSidebarCollapsed, false),
  );
  const [threadSourceFilter, setThreadSourceFilter] = useState<ThreadSourceFilter>(() =>
    readJsonPreference<ThreadSourceFilter>(uiPreferenceKeys.assistantChatThreadSourceFilter, "app"),
  );
  const [threadMenuState, setThreadMenuState] = useState<ThreadMenuState>(null);
  const [receiptSessionId, setReceiptSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [expandedMessageDetails, setExpandedMessageDetails] = useState<Record<string, boolean>>({});
  const [optimisticTurn, setOptimisticTurn] = useState<OptimisticTurn | null>(null);
  const [optimisticAssistantMessage, setOptimisticAssistantMessage] = useState<OptimisticAssistantMessage | null>(null);
  const [reviewingRunId, setReviewingRunId] = useState<string | null>(null);
  // Tracks the "request access" flow per permission key: "pending" while the
  // request is in flight, "sent"/"already" once resolved.
  const [permissionRequestState, setPermissionRequestState] = useState<Record<string, "pending" | "sent" | "already">>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceLevels, setVoiceLevels] = useState<number[]>(silentVoiceLevels);
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [dismissedFabUnreadCount, setDismissedFabUnreadCount] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const panelResizeStateRef = useRef<ChatPanelResizeState | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStopTimeoutRef = useRef<number | null>(null);
  const voiceMeterFrameRef = useRef<number | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const transientVoiceErrorTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousIsOpenRef = useRef(isOpen);
  const previousThreadSignatureRef = useRef("");

  const visibleSessions = useMemo(
    () => sessions.filter((session) => matchesThreadSourceFilter(session, threadSourceFilter)),
    [sessions, threadSourceFilter],
  );
  const activeVisibleSession = useMemo(
    () =>
      matchesThreadSourceFilter(activeSession, threadSourceFilter)
        ? activeSession
        : visibleSessions[0] ?? activeSession,
    [activeSession, threadSourceFilter, visibleSessions],
  );
  const resolvedActiveSession = useMemo(
    () => buildOptimisticSession(activeVisibleSession, optimisticTurn, optimisticAssistantMessage),
    [activeVisibleSession, optimisticAssistantMessage, optimisticTurn],
  );
  const activeSessionState = resolvedActiveSession.latestState;
  const stateActions = useMemo(() => buildStateActions(activeSessionState, t), [activeSessionState, t]);
  const threadMenuSession = useMemo(
    () => sessions.find((session) => session.id === threadMenuState?.sessionId) ?? null,
    [sessions, threadMenuState?.sessionId],
  );
  const threadMenuReceiptState = useMemo(() => findLatestOperationalReceiptState(threadMenuSession), [threadMenuSession]);
  const receiptSession = useMemo(
    () => sessions.find((session) => session.id === receiptSessionId) ?? null,
    [receiptSessionId, sessions],
  );
  const receiptViewerState = useMemo(() => findLatestOperationalReceiptState(receiptSession), [receiptSession]);
  const receiptViewerRows = useMemo(() => buildOperationalReceiptRows(receiptViewerState), [receiptViewerState]);
  const assistantFabUnreadCount = Math.max(0, agentUnreadCount - dismissedFabUnreadCount);

  useEffect(() => {
    if (isOpen) {
      setDismissedFabUnreadCount(agentUnreadCount);
    }
  }, [agentUnreadCount, isOpen]);

  useEffect(() => {
    if (agentUnreadCount === 0) {
      setDismissedFabUnreadCount(0);
    }
  }, [agentUnreadCount]);

  useEffect(() => {
    setCompareTrayVisible(compatibleItems.length >= 2);
  }, [compatibleItems.length, setCompareTrayVisible]);

  useEffect(() => {
    if (!isOpen) {
      setActiveSelector(null);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (!shellRef.current?.contains(target)) {
        setActiveSelector(null);
        close();
        return;
      }

      if (target instanceof Element) {
        if (!target.closest(".assistant-chat-selector")) {
          setActiveSelector(null);
        }

        if (!target.closest(".assistant-chat-session-menu-trigger") && !target.closest(".assistant-chat-session-menu-popover")) {
          setThreadMenuState(null);
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (activeSelector) {
        setActiveSelector(null);
        return;
      }

      if (threadMenuState) {
        setThreadMenuState(null);
        return;
      }

      if (receiptSessionId) {
        setReceiptSessionId(null);
        return;
      }

      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeSelector, close, isOpen, receiptSessionId, threadMenuState]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [isOpen, message]);

  useEffect(() => {
    setMessage("");
    setAttachments([]);
    setAttachmentError(null);
    setActionError(null);
    setActiveSelector(null);
    setThreadMenuState(null);
    setReceiptSessionId(null);
    setExpandedMessageDetails({});
    setOptimisticAssistantMessage(null);
    setSelectedApproval(activeVisibleSession.preferredApprovalMode);
    setSelectedModel(activeVisibleSession.preferredModelKey ?? "");
    setSelectedReasoning(activeVisibleSession.preferredReasoningEffort ?? "medium");

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, [
    activeVisibleSession.preferredApprovalMode,
    activeVisibleSession.preferredModelKey,
    activeVisibleSession.preferredReasoningEffort,
    resolvedActiveSession.id,
  ]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === expandedSessionId)) {
      setExpandedSessionId(null);
    }
  }, [expandedSessionId, sessions]);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.assistantChatSidebarCollapsed, isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.assistantChatThreadSourceFilter, threadSourceFilter);
  }, [threadSourceFilter]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextFrame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      const nextCursor = textarea.value.length;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });

    return () => window.cancelAnimationFrame(nextFrame);
  }, [resolvedActiveSession.id, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      previousIsOpenRef.current = false;
      return;
    }

    const threadSignature = `${resolvedActiveSession.id}:${resolvedActiveSession.messages.length}:${resolvedActiveSession.latestState?.label ?? ""}:${resolvedActiveSession.latestState?.tone ?? ""}`;
    const justOpened = !previousIsOpenRef.current;
    const threadChanged = previousThreadSignatureRef.current !== threadSignature;

    previousIsOpenRef.current = true;
    previousThreadSignatureRef.current = threadSignature;

    if (!justOpened && !threadChanged) {
      return;
    }

    const nextFrame = window.requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({
        block: "end",
        behavior: justOpened ? "auto" : "smooth",
      });
    });

    return () => window.cancelAnimationFrame(nextFrame);
  }, [isOpen, resolvedActiveSession.id, resolvedActiveSession.latestState, resolvedActiveSession.messages.length]);

  useEffect(
    () => () => {
      document.body.style.userSelect = "";
      if (voiceStopTimeoutRef.current) {
        window.clearTimeout(voiceStopTimeoutRef.current);
      }
      if (transientVoiceErrorTimeoutRef.current) {
        window.clearTimeout(transientVoiceErrorTimeoutRef.current);
      }
      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
      }
      if (voiceMeterFrameRef.current) {
        window.cancelAnimationFrame(voiceMeterFrameRef.current);
      }
      void audioContextRef.current?.close();
      mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const setTransientVoiceError = (message: string) => {
    if (transientVoiceErrorTimeoutRef.current) {
      window.clearTimeout(transientVoiceErrorTimeoutRef.current);
      transientVoiceErrorTimeoutRef.current = null;
    }

    setAttachmentError(message);
    transientVoiceErrorTimeoutRef.current = window.setTimeout(() => {
      setAttachmentError((current) => (current === message ? null : current));
      transientVoiceErrorTimeoutRef.current = null;
    }, transientVoiceErrorMs);
  };

  const stopVoiceMeter = () => {
    if (voiceMeterFrameRef.current) {
      window.cancelAnimationFrame(voiceMeterFrameRef.current);
      voiceMeterFrameRef.current = null;
    }

    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }

    void audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const startVoiceMeter = (stream: MediaStream) => {
    stopVoiceMeter();
    const AudioContextConstructor = window.AudioContext;

    if (!AudioContextConstructor) {
      setVoiceLevels(silentVoiceLevels);
      return;
    }

    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const bucketSize = Math.max(1, Math.floor(data.length / voiceWaveformBarCount));
      const nextLevels = Array.from({ length: voiceWaveformBarCount }, (_, index) => {
        const start = index * bucketSize;
        const bucket = data.slice(start, start + bucketSize);
        const average = bucket.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.length);
        return Math.max(0.08, Math.min(1, average / 128));
      });

      setVoiceLevels(nextLevels);
      voiceMeterFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  };

  const appendVoiceTranscript = (transcript: string) => {
    setMessage((current) => {
      const trimmedCurrent = current.trim();
      return trimmedCurrent ? `${trimmedCurrent}\n\n${transcript}` : transcript;
    });
  };

  const finishVoiceRecording = async (audioBlob: Blob) => {
    stopVoiceMeter();
    setVoiceState("transcribing");
    setAttachmentError(null);

    try {
      const dataUrl = await readBlobAsDataUrl(audioBlob);
      const result = await transcribeAssistantAudio({
        commandId: `cmd-voice-${Date.now().toString(36)}`,
        workspaceId,
        fileName: `assistant-voice-${Date.now().toString(36)}.webm`,
        mimeType: audioBlob.type || "audio/webm",
        dataUrl,
        source: "desktop",
      });

      appendVoiceTranscript(result.text);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      if (!isNoSpeechVoiceError(error)) {
        setTransientVoiceError(getUserFacingErrorMessage(error, "Voice transcription is unavailable right now."));
      }
    } finally {
      setVoiceState("idle");
      setVoiceElapsedMs(0);
      setVoiceLevels(silentVoiceLevels);
    }
  };

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.stop();
  };

  const startVoiceRecording = async () => {
    if (voiceState !== "idle" || !isWorkspaceReady) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setTransientVoiceError("Voice recording is not available on this device.");
      return;
    }

    setAttachmentError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startVoiceMeter(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopVoiceMeter();
        setTransientVoiceError("The microphone stopped unexpectedly. Try recording again.");
        setVoiceState("idle");
        setVoiceElapsedMs(0);
        setVoiceLevels(silentVoiceLevels);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.onstop = () => {
        stopVoiceMeter();
        if (voiceStopTimeoutRef.current) {
          window.clearTimeout(voiceStopTimeoutRef.current);
          voiceStopTimeoutRef.current = null;
        }

        const audioBlob = new Blob(voiceChunksRef.current, { type: preferredType || recorder.mimeType || "audio/webm" });
        voiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        stream.getTracks().forEach((track) => track.stop());

        if (!audioBlob.size) {
          setTransientVoiceError("No audio was captured. Try recording again.");
          setVoiceState("idle");
          setVoiceElapsedMs(0);
          setVoiceLevels(silentVoiceLevels);
          return;
        }

        void finishVoiceRecording(audioBlob);
      };

      recorder.start();
      const startedAt = Date.now();
      setVoiceState("recording");
      setVoiceElapsedMs(0);
      voiceTimerRef.current = window.setInterval(() => setVoiceElapsedMs(Date.now() - startedAt), 250);
      voiceStopTimeoutRef.current = window.setTimeout(stopVoiceRecording, maxVoiceRecordingMs);
    } catch (error) {
      stopVoiceMeter();
      setVoiceState("idle");
      setVoiceElapsedMs(0);
      setVoiceLevels(silentVoiceLevels);
      setTransientVoiceError(getUserFacingErrorMessage(error, "Microphone access was blocked. Allow microphone access and try again."));
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    }
  };

  const handleVoiceButtonClick = () => {
    if (voiceState === "recording") {
      stopVoiceRecording();
      return;
    }

    void startVoiceRecording();
  };

  const handleSend = async () => {
    const nextMessage = message.trim();

    if ((!nextMessage && !attachments.length) || isSending || voiceState !== "idle" || !isWorkspaceReady) {
      return;
    }

    const sessionId = activeSession.id;
    const intentLabel = deriveIntentLabel(location.pathname);
    const shouldNotifyCompletion = !isOpen || !document.hasFocus();
    const outgoingUserMessage = buildUserBubbleMessage(nextMessage, attachments);
    const pendingState = {
      tone: "sending",
      label: t("assistantChat.pending.supervisorReviewing"),
      body: t("assistantChat.pending.routingBody"),
      routedAgentId: null,
      routedAgentName: supervisorName,
      routedAgentRole: supervisorName,
      intentLabel,
      commandStateLabel: t("assistantChat.command.noChangesApplied"),
    } satisfies AssistantChatSessionState;

    open();
    setMessage("");
    setAttachments([]);
    setAttachmentError(null);
    setOptimisticTurn({
      threadId: sessionId,
      userMessage: {
        id: `assistant-optimistic-user-${Date.now().toString(36)}`,
        role: "user",
        body: outgoingUserMessage,
        source: null,
      },
      state: pendingState,
    });

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }

    setIsSending(true);

    try {
      const nextSnapshot = await sendTurn({
        commandId: `cmd-chat-${Date.now().toString(36)}`,
        workspaceId,
        threadId: sessionId,
        message: nextMessage,
        attachments,
        context: {
          workspaceId,
          activePath: location.pathname,
          activeProjectId: location.pathname.startsWith("/projects/") ? location.pathname.split("/")[2] ?? null : null,
          currentView: resolvedActiveSession.contextLabel,
          activeFilters: {},
          requestedApprovalMode: selectedApproval,
          actorDisplayName: user?.displayName ?? null,
          requestedModelKey: selectedModel || null,
          requestedReasoningEffort: selectedReasoning,
        },
      });
      const latestMeta = getLatestAssistantMeta(nextSnapshot, sessionId);
      if (latestMeta?.notificationIntents?.length) {
        await applyAgentNotificationIntents(latestMeta.notificationIntents, sessionId).catch(() => undefined);
      }
      if (shouldNotifyCompletion) {
        const notification = buildAgentCompletionNotification(latestMeta, location.pathname, sessionId);
        await createNotification({
          kind: "agent_completion",
          title: notification.title,
          body: notification.body,
          linkTo: notification.linkTo,
          sourceType: "agent",
          sourceRef: notification.sourceRef,
          notifyNow: true,
        }).catch(() => undefined);
      }
    } catch (error) {
      setAttachmentError(getUserFacingErrorMessage(error, t("assistantChat.errors.prepareDraft")));
    } finally {
      setOptimisticTurn(null);
      setIsSending(false);
    }
  };

  const handleReviewRun = async (runId: string, decision: "approve" | "deny" | "approve_for_session") => {
    if (!isWorkspaceReady) {
      return;
    }

    setReviewingRunId(runId);
    setActionError(null);
    if (decision !== "deny") {
      setOptimisticAssistantMessage({
        threadId: resolvedActiveSession.id,
        message: {
          id: `assistant-optimistic-review-${Date.now().toString(36)}`,
          role: "assistant",
          body:
            decision === "approve_for_session"
              ? t("assistantChat.review.continuingSessionBody")
              : t("assistantChat.review.continuingSupervisedBody"),
          state: {
            tone: "sending",
            label:
              decision === "approve_for_session"
                ? t("assistantChat.review.continuingSession")
                : t("assistantChat.review.continuing"),
            body:
              decision === "approve_for_session"
                ? t("assistantChat.review.sessionApprovalBody")
                : t("assistantChat.review.approvalBody"),
            routedAgentId: resolvedActiveSession.lastRoutedAgentId,
            routedAgentName: activeSessionState?.routedAgentName ?? supervisorName,
            routedAgentRole: activeSessionState?.routedAgentRole ?? supervisorName,
            intentLabel: t("assistantChat.review.decisionRecorded"),
            commandStateLabel: t("assistantChat.command.noChangesApplied"),
            draftRunId: runId,
            approvalDecision: decision === "approve_for_session" ? "approved_for_session" : "approved",
            approvalScope: decision === "approve_for_session" ? "session" : "run",
          },
        },
      });
    }

    try {
      const result = await reviewAgentRun({
        commandId: `cmd-chat-review-${Date.now().toString(36)}`,
        workspaceId,
        runId,
        decision,
      });
      await refresh();
      if (!isOpen || !document.hasFocus()) {
        await createNotification({
          kind: "agent_completion",
          title: decision === "deny" ? t("assistantChat.notifications.runDenied") : t("assistantChat.notifications.runUpdated"),
          body: result.summary,
          linkTo: "/agents/runs",
          sourceType: "agent",
          sourceRef: {
            runId: result.runId,
            status: result.status,
            approvalDecision: result.approvalDecision,
            approvalScope: result.approvalScope,
          },
          notifyNow: true,
        }).catch(() => undefined);
      }
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, "I could not record that decision yet."));
    } finally {
      setOptimisticAssistantMessage(null);
      setReviewingRunId(null);
    }
  };

  const handleRequestPermission = async (permission: string) => {
    if (!isWorkspaceReady || permissionRequestState[permission] === "pending") {
      return;
    }

    setPermissionRequestState((current) => ({ ...current, [permission]: "pending" }));
    setActionError(null);
    try {
      const result = await requestAgentPermission({
        commandId: `cmd-chat-perm-${Date.now().toString(36)}`,
        workspaceId,
        permission,
      });
      setPermissionRequestState((current) => ({
        ...current,
        [permission]: result.alreadyRequested ? "already" : "sent",
      }));
    } catch (error) {
      setPermissionRequestState((current) => {
        const next = { ...current };
        delete next[permission];
        return next;
      });
      setActionError(getUserFacingErrorMessage(error, t("assistantChat.permission.requestFailed")));
    }
  };

  const handleApprovalPreferenceChange = async (nextValue: AssistantApprovalPreference) => {
    setSelectedApproval(nextValue);
    await updateSessionPreferences(resolvedActiveSession.id, { preferredApprovalMode: nextValue });
  };

  const handleModelPreferenceChange = async (nextValue: string) => {
    setSelectedModel(nextValue);
    await updateSessionPreferences(resolvedActiveSession.id, {
      preferredModelKey: nextValue || null,
    });
  };

  const handleReasoningPreferenceChange = async (nextValue: AssistantReasoningEffort) => {
    setSelectedReasoning(nextValue);
    await updateSessionPreferences(resolvedActiveSession.id, {
      preferredReasoningEffort: nextValue,
    });
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleAttachmentSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (!files.length) {
      return;
    }

    const availableSlots = Math.max(0, maxImageAttachments - attachments.length);

    if (!availableSlots) {
      setAttachmentError(`You can attach up to ${maxImageAttachments} files per message.`);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      return;
    }

    const nextFiles = files.slice(0, availableSlots);

    try {
      const nextAttachments = await Promise.all(nextFiles.map((file) => toChatAttachment(file)));
      setAttachments((current) => [...current, ...nextAttachments]);
      setAttachmentError(
        files.length > nextFiles.length ? `Only ${availableSlots} files were attached to keep this message lightweight.` : null,
      );
    } catch (error) {
      setAttachmentError(getUserFacingErrorMessage(error, "I could not attach that file."));
    } finally {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
    }
  };

  const openThreadMenu = (sessionId: string, element: HTMLButtonElement) => {
    const panelRect = panelRef.current?.getBoundingClientRect();
    const triggerRect = element.getBoundingClientRect();

    if (!panelRect) {
      setThreadMenuState({ sessionId, top: 0, left: 0 });
      return;
    }

    const menuWidth = 206;
    const menuHeight = 178;
    const top = Math.min(
      Math.max(12, triggerRect.bottom - panelRect.top + 6),
      panelRect.height - menuHeight - 12,
    );
    const preferredLeft = triggerRect.right - panelRect.left - menuWidth;
    const left = Math.min(
      Math.max(12, preferredLeft),
      panelRect.width - menuWidth - 12,
    );

    setThreadMenuState((current) =>
      current?.sessionId === sessionId ? null : { sessionId, top, left },
    );
  };

  const handlePanelResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRef.current || event.button !== 0) {
      return;
    }

    event.preventDefault();

    const currentScale = panelScale;
    const rect = panelRef.current.getBoundingClientRect();
    const baseWidth = rect.width / currentScale;
    const baseHeight = rect.height / currentScale;
    const maxScale = Math.max(
      1,
      Math.min(
        1.5,
        (window.innerWidth - 32) / baseWidth,
        (window.innerHeight - 32) / baseHeight,
      ),
    );

    panelResizeStateRef.current = {
      maxScale,
      startHeight: rect.height,
      startScale: currentScale,
      startWidth: rect.width,
      startX: event.clientX,
      startY: event.clientY,
    };
    setIsPanelResizing(true);
    document.body.style.userSelect = "none";

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = panelResizeStateRef.current;
      if (!state) {
        return;
      }

      const nextWidth = state.startWidth + (state.startX - moveEvent.clientX);
      const nextHeight = state.startHeight + (state.startY - moveEvent.clientY);
      const widthScale = nextWidth / baseWidth;
      const heightScale = nextHeight / baseHeight;
      const nextScale = Math.min(Math.max(Math.max(widthScale, heightScale), 1), state.maxScale);
      setPanelScale(nextScale);
    };

    const finish = (endEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", handlePointerMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(endEvent.pointerId)) {
        handle.releasePointerCapture(endEvent.pointerId);
      }
      panelResizeStateRef.current = null;
      setIsPanelResizing(false);
      document.body.style.userSelect = "";
    };

    handle.addEventListener("pointermove", handlePointerMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  return (
    <div
      ref={shellRef}
      className={`assistant-shell${compareTrayVisible ? " assistant-shell-with-compare" : ""}${isOpen ? " is-open" : ""}`}
    >
      {isOpen ? (
        <section
          ref={panelRef}
          className={`assistant-chat-panel${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}${isPanelResizing ? " is-resizing" : ""}`}
          aria-label="Global assistant chat"
          style={{ "--assistant-chat-scale": panelScale } as CSSProperties}
        >
          <div
            aria-hidden="true"
            className="assistant-chat-resize-corner"
            onPointerDown={handlePanelResizeStart}
          />
          <aside className="assistant-chat-sidebar">
            <div className="assistant-chat-sidebar-header">
              <div>
                <strong className="assistant-chat-sidebar-title">Threads</strong>
              </div>
              <div className="assistant-chat-sidebar-tools">
                <button
                  aria-label="Create new thread"
                  className="assistant-chat-sidebar-tool"
                  data-tooltip="New thread"
                  onClick={() => void createSession()}
                  type="button"
                >
                  <Plus size={16} />
                </button>
                <button
                  aria-label="Collapse threads sidebar"
                  className="assistant-chat-sidebar-tool"
                  data-tooltip="Collapse threads"
                  onClick={() => setIsSidebarCollapsed(true)}
                  type="button"
                >
                  <PanelLeft size={16} />
                </button>
              </div>
            </div>

            <div className="assistant-chat-source-filter" aria-label="Thread source filter">
              {threadSourceFilterOptions.map((option) => (
                <button
                  key={option.value}
                  className={`assistant-chat-source-filter-button${threadSourceFilter === option.value ? " is-active" : ""}`}
                  onClick={() => {
                    setThreadSourceFilter(option.value);
                    setThreadMenuState(null);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="assistant-chat-session-list">
              {visibleSessions.length ? null : (
                <div className="assistant-chat-session-empty">
                  No {threadSourceFilter === "telegram" ? "Telegram" : "app"} threads yet.
                </div>
              )}
              {visibleSessions.map((session) => {
                const isExpanded = expandedSessionId === session.id;
                const hasState = Boolean(session.latestState);

                return (
                  <div
                    key={session.id}
                    className={`assistant-chat-session-row${session.id === resolvedActiveSession.id ? " is-active" : ""}${
                      threadMenuState?.sessionId === session.id ? " is-menu-open" : ""
                    }`}
                  >
                    <div className="assistant-chat-session-main">
                      {renamingSessionId === session.id ? (
                        <div className="assistant-chat-session-select assistant-chat-session-rename">
                          <input
                            autoFocus
                            className="assistant-chat-session-rename-input"
                            onBlur={() => {
                              const nextTitle = renameDraft.trim();
                              if (nextTitle && nextTitle !== session.title) {
                                void renameSession(session.id, nextTitle);
                              }
                              setRenamingSessionId(null);
                            }}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                const nextTitle = renameDraft.trim();
                                if (nextTitle && nextTitle !== session.title) {
                                  void renameSession(session.id, nextTitle);
                                }
                                setRenamingSessionId(null);
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                setRenamingSessionId(null);
                              }
                            }}
                            value={renameDraft}
                          />
                        </div>
                      ) : (
                        <button className="assistant-chat-session-select" onClick={() => void selectSession(session.id)} type="button">
                          <div className="assistant-chat-session-copy">
                            <strong>{session.title}</strong>
                            <span>{getThreadSourceLabel(session)}</span>
                          </div>
                        </button>
                      )}

                      <div className="assistant-chat-session-actions">
                        <button
                          aria-label={isExpanded ? "Hide thread details" : "Show thread details"}
                          className={`assistant-chat-session-action${isExpanded ? " is-open" : ""}`}
                          data-tooltip={isExpanded ? "Hide thread details" : "Show thread details"}
                          onClick={() => setExpandedSessionId((current) => (current === session.id ? null : session.id))}
                          type="button"
                        >
                          <ChevronDown size={14} />
                        </button>

                        <button
                          aria-label={`Open thread menu for ${session.title}`}
                          className={`assistant-chat-session-action assistant-chat-session-menu-trigger${
                            threadMenuState?.sessionId === session.id ? " is-open" : ""
                          }`}
                          data-tooltip={t("assistantChat.actions.threadActions")}
                          onClick={(event) => openThreadMenu(session.id, event.currentTarget)}
                          type="button"
                        >
                          <Ellipsis size={14} />
                        </button>
                      </div>

                      <span className="assistant-chat-session-age">{formatThreadTimestamp(session.updatedAt)}</span>
                    </div>

                    {isExpanded ? (
                      <div className="assistant-chat-session-detail">
                        <div className="assistant-chat-session-detail-row">
                          <span>{t("assistantChat.session.context")}</span>
                          <strong>{session.contextLabel}</strong>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>{t("assistantChat.session.assigned")}</span>
                          <div className="assistant-chat-assigned-agent">
                            <strong>
                              {hasState
                                ? session.latestState?.routedAgentName ?? supervisorName
                                : t("assistantChat.session.notRoutedYet")}
                            </strong>
                            {hasState && session.latestState?.routedAgentRole ? (
                              <span>{session.latestState.routedAgentRole}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>{t("assistantChat.session.intent")}</span>
                          <strong>
                            {hasState
                              ? session.latestState?.intentLabel ?? t("assistantChat.session.pendingClassification")
                              : t("assistantChat.session.pendingClassification")}
                          </strong>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>{t("assistantChat.session.command")}</span>
                          <strong>
                            {hasState
                              ? session.latestState?.commandStateLabel ?? t("assistantChat.command.noChangesApplied")
                              : t("assistantChat.command.noChangesApplied")}
                          </strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="assistant-chat-main">
            <div className="assistant-chat-topbar">
              <div className="assistant-chat-topbar-leading">
                {isSidebarCollapsed ? (
                  <button
                    aria-label={t("assistantChat.actions.expandThreads")}
                    className="surface-card-action"
                    data-tooltip={t("assistantChat.actions.expandThreads")}
                    onClick={() => setIsSidebarCollapsed(false)}
                    type="button"
                  >
                    <PanelLeft size={16} />
                  </button>
                ) : null}
                <div className="assistant-chat-context-pill">{resolvedActiveSession.contextLabel}</div>
              </div>
              <button
                aria-label={t("assistantChat.actions.close")}
                className="icon-ghost-control"
                data-tooltip={t("assistantChat.actions.close")}
                onClick={close}
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <div className="assistant-chat-thread">
              {resolvedActiveSession.messages.map((entry) => {
                if (entry.role === "user") {
                  const sourceMeta = [entry.source?.actorRole, entry.source?.channelLabel].filter(Boolean).join(" · ");
                  const sourceLabel = getUserMessageSourceLabel(entry.source);
                  return (
                    <div key={entry.id} className="assistant-chat-message-block assistant-chat-message-block-user">
                      {entry.source ? (
                        <div className="assistant-chat-message-meta assistant-chat-message-meta-user">
                          <div className="assistant-chat-speaker-meta">
                            <span className="assistant-chat-speaker-pill assistant-chat-speaker-pill-external">
                              {sourceLabel}
                            </span>
                            {sourceMeta ? <span className="assistant-chat-speaker-role">{sourceMeta}</span> : null}
                          </div>
                        </div>
                      ) : null}
                      <div className="assistant-chat-bubble assistant-chat-bubble-user">
                        <div className="assistant-chat-bubble-content">{renderMessageMarkdown(entry.body)}</div>
                      </div>
                    </div>
                  );
                }

                const messageState = entry.state ?? null;
                const isExpanded = expandedMessageDetails[entry.id] ?? false;
                const messageActions = buildStateActions(messageState, t);
                const resultLinks = messageState?.actionLinks ?? [];
                const needsApproval = Boolean(messageState?.draftRunId && messageState.approvalDecision === "pending");
                const approvalResolved = Boolean(
                  messageState?.draftRunId &&
                    messageState.approvalDecision &&
                    messageState.approvalDecision !== "pending",
                );

                return (
                  <div key={entry.id} className="assistant-chat-message-block assistant-chat-message-block-assistant">
                    <div className="assistant-chat-message-meta">
                      <div className="assistant-chat-speaker-meta">
                        <span className={`assistant-chat-speaker-pill${messageState ? ` assistant-chat-speaker-pill-${messageState.tone}` : ""}`}>
                          {messageState?.routedAgentName ?? supervisorName}
                        </span>
                        {messageState?.routedAgentRole ? (
                          <span className="assistant-chat-speaker-role">{messageState.routedAgentRole}</span>
                        ) : null}
                      </div>
                      {messageState ? (
                        <button
                          aria-label={isExpanded ? t("assistantChat.actions.hideDetails") : t("assistantChat.actions.showDetails")}
                          className={`assistant-chat-message-toggle${isExpanded ? " is-open" : ""}`}
                          onClick={() =>
                            setExpandedMessageDetails((current) => ({
                              ...current,
                              [entry.id]: !isExpanded,
                            }))
                          }
                          type="button"
                        >
                          <ChevronDown size={14} />
                        </button>
                      ) : null}
                    </div>

                    <div
                      className={`assistant-chat-bubble assistant-chat-bubble-assistant${
                        resultLinks.length ? " assistant-chat-bubble-with-result" : ""
                      }`}
                    >
                      <div className="assistant-chat-bubble-content">{renderMessageMarkdown(entry.body)}</div>
                    </div>

                    {messageState && resultLinks.length ? (
                      <div className="assistant-chat-result-card">
                        <div className="assistant-chat-result-icon">
                          <CheckCircle2 size={15} />
                        </div>
                        <div className="assistant-chat-result-copy">
                          <span className="assistant-chat-result-eyebrow">{t("assistantChat.actionCompleted")}</span>
                          <strong>{buildActionResultSummary(messageState, t)}</strong>
                          <div className="assistant-chat-result-actions">
                            {resultLinks.map((link) => (
                              <button
                                key={`${link.entityType}:${link.entityId}:${link.path}`}
                                className="assistant-chat-result-link"
                                onClick={() => {
                                  navigate(link.path);
                                  close();
                                }}
                                type="button"
                              >
                                <span>{link.label}</span>
                                <ExternalLink size={12} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {needsApproval && messageState?.draftRunId ? (
                      <div className="assistant-chat-approval-card">
                        <div className="assistant-chat-approval-copy">
                          <span className="assistant-chat-approval-eyebrow">{t("agents.runs.approvalRequired")}</span>
                          <strong>{t("assistantChat.approval.chooseHandling")}</strong>
                          <p>{messageState.approvalReason ?? t("assistantChat.approval.noExecutionYet")}</p>
                          {messageState.pendingMutation ? (
                            <div className="assistant-chat-mutation-preview">
                              <span className="assistant-chat-mutation-tag">{t("assistantChat.approval.ifApproved")}</span>
                              <strong>{messageState.pendingMutation.summary}</strong>
                              <code>{messageState.pendingMutation.toolName}</code>
                            </div>
                          ) : null}
                        </div>
                        <div className="assistant-chat-approval-actions">
                          <button
                            className="primary-control"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "approve")}
                            type="button"
                          >
                            {t("agents.runs.approve")}
                          </button>
                          <button
                            className="surface-card-action-text"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "approve_for_session")}
                            type="button"
                          >
                            {t("agents.runs.approveForSession")}
                          </button>
                          <button
                            className="surface-card-action-text assistant-chat-approval-deny"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "deny")}
                            type="button"
                          >
                            {t("agents.runs.deny")}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {approvalResolved && messageState ? (
                      <div className={`assistant-chat-approval-result ${resolveApprovalToneClass(messageState.approvalDecision)}`}>
                        <span className="assistant-chat-approval-result-pill">
                          {messageState.approvalDecision?.replace(/_/g, " ")}
                        </span>
                        <p>{resolveApprovalSummary(messageState, t)}</p>
                      </div>
                    ) : null}

                    {messageState?.permissionRequests?.length
                      ? messageState.permissionRequests.map((request) => {
                          const status = permissionRequestState[request.permission];
                          return (
                            <div className="assistant-chat-permission-card" key={request.permission}>
                              <div className="assistant-chat-permission-copy">
                                <span className="assistant-chat-permission-eyebrow">
                                  {t("assistantChat.permission.eyebrow")}
                                </span>
                                <strong>{t("assistantChat.permission.title", { permission: request.label })}</strong>
                                <p>{t("assistantChat.permission.body")}</p>
                              </div>
                              {status === "sent" || status === "already" ? (
                                <span className="assistant-chat-permission-sent">
                                  {status === "already"
                                    ? t("assistantChat.permission.alreadyRequested")
                                    : t("assistantChat.permission.requested")}
                                </span>
                              ) : (
                                <button
                                  className="primary-control"
                                  disabled={status === "pending"}
                                  onClick={() => void handleRequestPermission(request.permission)}
                                  type="button"
                                >
                                  {status === "pending"
                                    ? t("assistantChat.permission.requesting")
                                    : t("assistantChat.permission.requestAccess")}
                                </button>
                              )}
                            </div>
                          );
                        })
                      : null}

                    {messageState && isExpanded ? (
                      <div className="assistant-chat-message-details">
                        <span className={`assistant-chat-state-pill assistant-chat-state-pill-${messageState.tone}`}>
                          {messageState.label}
                        </span>
                        <p className="assistant-chat-state-body">{messageState.body}</p>
                        {messageState.approvalReason ? (
                          <p className="assistant-chat-state-body assistant-chat-state-body-subtle">{messageState.approvalReason}</p>
                        ) : null}
                        <div className="assistant-chat-state-meta">
                          <span>{messageState.intentLabel}</span>
                          {messageState.toolLabel ? <span>{messageState.toolLabel}</span> : null}
                          <span>{messageState.commandStateLabel}</span>
                        </div>
                        {messageActions.length ? (
                          <div className="assistant-chat-state-actions">
                            {messageActions.map((action) => (
                              <button
                                key={action.label}
                                className="assistant-chat-state-link"
                                onClick={() => {
                                  navigate(action.to);
                                  close();
                                }}
                                type="button"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {isSending && activeSessionState?.tone === "sending" ? (
                <div className="assistant-chat-inline-status">
                  <div className="assistant-chat-inline-thinking">
                    <span className="assistant-chat-inline-thinking-label">{t("assistantChat.thinkingLabel", { defaultValue: "{{name}} thinking", name: supervisorName })}</span>
                    <span aria-hidden="true" className="assistant-chat-inline-thinking-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                  <span className="assistant-chat-inline-status-copy">Classifying intent and checking supervised context.</span>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>

            <div className="assistant-chat-composer">
              {actionError ? <div className="assistant-chat-action-error">{actionError}</div> : null}
              <div className="assistant-chat-compose-shell">
                <textarea
                  ref={textareaRef}
                  className="assistant-chat-input"
                  onChange={(event) => setMessage(event.target.value)}
                  onFocus={() => setActiveSelector(null)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask the assistant..."
                  rows={4}
                  value={message}
                />
                <button
                  aria-label="Attach files"
                  className="assistant-chat-attach-button"
                  data-tooltip="Attach files"
                  onClick={() => attachmentInputRef.current?.click()}
                  type="button"
                >
                  <Plus size={18} />
                </button>
                <div className="assistant-chat-compose-actions">
                  <button
                    aria-label={
                      voiceState === "recording"
                        ? "Stop voice recording"
                        : voiceState === "transcribing"
                          ? "Transcribing voice recording"
                          : "Record voice message"
                    }
                    className={`assistant-chat-mic-button${voiceState === "recording" ? " is-recording" : ""}${voiceState === "transcribing" ? " is-transcribing" : ""}`}
                    data-tooltip={
                      !isWorkspaceReady
                        ? "Select a workspace to record voice"
                        : voiceState === "recording"
                          ? "Stop recording"
                          : voiceState === "transcribing"
                            ? "Transcribing"
                            : "Record voice"
                    }
                    disabled={isSending || !isWorkspaceReady || voiceState === "transcribing"}
                    onClick={handleVoiceButtonClick}
                    type="button"
                  >
                    {voiceState === "transcribing" ? (
                      <LoaderCircle className="assistant-chat-voice-spinner" size={16} />
                    ) : voiceState === "recording" ? (
                      <Square size={15} />
                    ) : (
                      <Mic size={16} />
                    )}
                  </button>
                  <button
                    aria-label={isSending ? "Routing message" : "Send message"}
                    className="assistant-chat-send-button"
                    data-tooltip={
                      !isWorkspaceReady
                        ? "Select a workspace to start chatting"
                        : isSending
                          ? "Routing message"
                          : "Send message"
                    }
                    disabled={isSending || voiceState !== "idle" || !isWorkspaceReady || (!message.trim() && !attachments.length)}
                    onClick={handleSend}
                    type="button"
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
                {voiceState === "recording" ? (
                  <div aria-live="polite" className="assistant-chat-voice-waveform" role="status">
                    <span className="assistant-chat-voice-waveform-label">{formatVoiceDuration(voiceElapsedMs)}</span>
                    <span aria-hidden="true" className="assistant-chat-voice-waveform-bars">
                      {voiceLevels.map((level, index) => (
                        <span key={index} style={{ "--bar-level": level, "--bar-index": index } as CSSProperties} />
                      ))}
                    </span>
                  </div>
                ) : voiceState === "transcribing" ? (
                  <div aria-live="polite" className="assistant-chat-voice-waveform is-transcribing" role="status">
                    <span className="assistant-chat-voice-waveform-label">Transcribing</span>
                    <span aria-hidden="true" className="assistant-chat-voice-waveform-bars">
                      {silentVoiceLevels.map((level, index) => (
                        <span key={index} style={{ "--bar-level": level, "--bar-index": index } as CSSProperties} />
                      ))}
                    </span>
                  </div>
                ) : null}
              </div>

              <input
                ref={attachmentInputRef}
                accept="image/*,.csv,.xlsx,.xls,.pdf,.txt,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="assistant-chat-file-input"
                multiple
                onChange={handleAttachmentSelection}
                type="file"
              />

              {attachments.length ? (
                <div className="assistant-chat-attachments">
                  {attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className={`assistant-chat-attachment-chip is-${attachment.kind}`}
                    >
                      {attachment.kind === "image" ? (
                        <img alt="" className="assistant-chat-attachment-thumb" src={attachment.dataUrl} />
                      ) : (
                        <FileText className="assistant-chat-attachment-icon" size={13} />
                      )}
                      <span className="assistant-chat-attachment-name">{attachment.name}</span>
                      <button
                        aria-label={`Remove ${attachment.name}`}
                        className="assistant-chat-attachment-remove"
                        data-tooltip={`Remove ${attachment.name}`}
                        onClick={() => {
                          setAttachments((current) => current.filter((item) => item.id !== attachment.id));
                          setAttachmentError(null);
                        }}
                        type="button"
                      >
                        <Trash2 size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {attachmentError ? <p className="assistant-chat-attachment-error">{attachmentError}</p> : null}

              <div className="assistant-chat-controls-row">
                <div className="assistant-chat-selector">
                  <button
                    className={`assistant-chat-control-link${activeSelector === "model" ? " is-open" : ""}`}
                    onClick={() => setActiveSelector((current) => (current === "model" ? null : "model"))}
                    type="button"
                  >
                    <span>{selectedModelLabel ?? t("assistantChat.model.agentDefault", { defaultValue: "Modelo del agente" })}</span>
                    <ChevronDown size={14} />
                  </button>
                  {activeSelector === "model" ? (
                    <div className="assistant-chat-selector-popover">
                      <button
                        className={`assistant-chat-selector-option${selectedModel === "" ? " is-selected" : ""}`}
                        onClick={() => {
                          void handleModelPreferenceChange("");
                          setActiveSelector(null);
                        }}
                        type="button"
                      >
                        {t("assistantChat.model.agentDefault", { defaultValue: "Modelo del agente" })}
                      </button>
                      {modelChoices.map((choice) => (
                        <button
                          key={choice.modelKey}
                          className={`assistant-chat-selector-option${selectedModel === choice.modelKey ? " is-selected" : ""}`}
                          onClick={() => {
                            void handleModelPreferenceChange(choice.modelKey);
                            setActiveSelector(null);
                          }}
                          type="button"
                        >
                          {choice.label}
                        </button>
                      ))}
                      {modelChoices.length === 0 ? (
                        <span className="assistant-chat-selector-empty">
                          {t("assistantChat.model.empty", { defaultValue: "Configura un proveedor en Modelos" })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="assistant-chat-selector">
                  <button
                    className={`assistant-chat-control-link${activeSelector === "reasoning" ? " is-open" : ""}`}
                    onClick={() => setActiveSelector((current) => (current === "reasoning" ? null : "reasoning"))}
                    type="button"
                  >
                    <span>{t(`assistantChat.reasoning.${selectedReasoning.toLowerCase()}`, { defaultValue: selectedReasoning })}</span>
                    <ChevronDown size={14} />
                  </button>
                  {activeSelector === "reasoning" ? (
                    <div className="assistant-chat-selector-popover">
                      {reasoningOptions.map((option) => (
                        <button
                          key={option}
                          className={`assistant-chat-selector-option${selectedReasoning === option ? " is-selected" : ""}`}
                          onClick={() => {
                            void handleReasoningPreferenceChange(option);
                            setActiveSelector(null);
                          }}
                          type="button"
                        >
                          {t(`assistantChat.reasoning.${option.toLowerCase()}`, { defaultValue: option })}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="assistant-chat-selector">
                  <button
                    className={`assistant-chat-control-link${activeSelector === "approval" ? " is-open" : ""}`}
                    onClick={() => setActiveSelector((current) => (current === "approval" ? null : "approval"))}
                    type="button"
                  >
                    <span>{t(approvalOptions.find((option) => option.value === selectedApproval)?.labelKey ?? "assistantChat.approvalMode.supervised")}</span>
                    <ChevronDown size={14} />
                  </button>
                  {activeSelector === "approval" ? (
                    <div className="assistant-chat-selector-popover">
                      {approvalOptions.map((option) => (
                        <button
                          key={option.value}
                          className={`assistant-chat-selector-option${selectedApproval === option.value ? " is-selected" : ""}`}
                          onClick={() => {
                            void handleApprovalPreferenceChange(option.value);
                            setActiveSelector(null);
                          }}
                          type="button"
                        >
                          {t(option.labelKey)}
                        </button>
                      ))}
                      <p className="assistant-chat-selector-helper">
                        {t(`assistantChat.approvalModeDescription.${selectedApproval}`)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {threadMenuState ? (
            <div
              className="assistant-chat-session-menu-popover"
              style={{ top: `${threadMenuState.top}px`, left: `${threadMenuState.left}px` }}
            >
              <button
                className="assistant-chat-session-menu-item"
                onClick={() => {
                  void selectSession(threadMenuState.sessionId);
                  setExpandedSessionId((current) => (current === threadMenuState.sessionId ? null : threadMenuState.sessionId));
                  setThreadMenuState(null);
                }}
                type="button"
              >
                {expandedSessionId === threadMenuState.sessionId ? "Hide details" : "Show details"}
              </button>
              {threadMenuSession?.latestState?.tone !== "sending" ? (
                <button
                  className="assistant-chat-session-menu-item"
                  onClick={() => {
                    navigate("/agents/runs");
                    setThreadMenuState(null);
                    close();
                  }}
                  type="button"
                >
                  {t("assistantChat.actions.openRuns")}
                </button>
              ) : null}
              {threadMenuSession?.latestState?.routedAgentId ? (
                <button
                  className="assistant-chat-session-menu-item"
                  onClick={() => {
                    const routedAgentId = threadMenuSession?.latestState?.routedAgentId ?? "";
                    navigate(`/agents/mission-control?agent=${encodeURIComponent(routedAgentId)}`);
                    setThreadMenuState(null);
                    close();
                  }}
                  type="button"
                >
                  {t("assistantChat.actions.viewAgent")}
                </button>
              ) : null}
              {threadMenuReceiptState?.operationalReceipt ? (
                <button
                  className="assistant-chat-session-menu-item"
                  onClick={() => {
                    setReceiptSessionId(threadMenuState.sessionId);
                    setThreadMenuState(null);
                  }}
                  type="button"
                >
                  <FileText size={13} />
                  <span>{t("assistantChat.actions.viewOperationalReceipt")}</span>
                </button>
              ) : null}
              <button
                className="assistant-chat-session-menu-item"
                onClick={() => {
                  const target = threadMenuSession;
                  setThreadMenuState(null);
                  if (!target) return;
                  setRenamingSessionId(target.id);
                  setRenameDraft(target.title);
                }}
                type="button"
              >
                <Pencil size={13} />
                <span>Rename thread</span>
              </button>
              <button
                className="assistant-chat-session-menu-item is-danger"
                onClick={() => {
                  void deleteSession(threadMenuState.sessionId);
                  setThreadMenuState(null);
                }}
                type="button"
              >
                <Trash2 size={13} />
                <span>Delete thread</span>
              </button>
            </div>
          ) : null}

          {receiptSession && receiptViewerState?.operationalReceipt ? (
            <div
              className="assistant-chat-receipt-modal-backdrop"
              onMouseDown={() => setReceiptSessionId(null)}
              role="presentation"
            >
              <section
                aria-label={t("assistantChat.actions.viewOperationalReceipt")}
                className="assistant-chat-receipt-modal"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="assistant-chat-receipt-modal-header">
                  <div>
                    <span className="assistant-chat-result-eyebrow">{t("agents.runs.operationalReceipt")}</span>
                    <strong>{receiptViewerState.operationalReceipt.summary}</strong>
                    <p>{receiptSession.title}</p>
                  </div>
                  <button
                    aria-label={t("assistantChat.actions.closeOperationalReceipt")}
                    className="icon-ghost-control"
                    data-tooltip={t("assistantChat.actions.closeOperationalReceipt")}
                    onClick={() => setReceiptSessionId(null)}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                </div>
                {receiptViewerRows.length ? (
                  <div className="assistant-chat-receipt-items">
                    {receiptViewerRows.map((item, index) => (
                      <div key={`${item.status}:${item.label}:${index}`} className="assistant-chat-receipt-item">
                        <span className={`assistant-chat-receipt-dot assistant-chat-receipt-dot-${item.status}`} />
                        <div>
                          <strong>{item.label}</strong>
                          {item.detail ? <p>{item.detail}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {receiptViewerState.operationalReceipt.nextSteps[0] ? (
                  <p className="assistant-chat-receipt-next">
                    {t("agents.runs.nextStep", { step: receiptViewerState.operationalReceipt.nextSteps[0] })}
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <button aria-label="Open global assistant" className="assistant-chat-fab" onClick={toggle} type="button">
        <Bot size={24} />
        {!isOpen && assistantFabUnreadCount > 0 ? <span className="assistant-chat-fab-badge">{Math.min(assistantFabUnreadCount, 99)}</span> : null}
      </button>
    </div>
  );
};
