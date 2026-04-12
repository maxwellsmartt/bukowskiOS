import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowUp, Bot, ChevronDown, Ellipsis, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AssistantChatSession, AssistantChatSessionState } from "@app/providers/AssistantChatContext";
import type { AssistantApprovalPreference, AssistantGatewayAttachment } from "@contracts";

import { useAssistantChat } from "@app/providers/AssistantChatContext";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { reviewAgentRun } from "@features/agents/useAgentsData";

const workspaceId = "workspace-metadata";
const modelOptions = ["GPT-5.4", "Claude Sonnet", "OpenClaw Balanced"];
const reasoningOptions = ["Low", "Medium", "High"];
const approvalOptions: Array<{ label: string; value: AssistantApprovalPreference }> = [
  { label: "Supervised", value: "supervised" },
  { label: "Needs approval", value: "needs_approval" },
  { label: "Unsupervised", value: "unsupervised" },
];
const approvalModeDescriptions: Record<AssistantApprovalPreference, string> = {
  supervised: "Drafts and delegated work stay review-aware.",
  needs_approval: "Always ask before continuing delegated work in this thread.",
  unsupervised: "Skips approval prompts for supervised agents only. Agents marked needs approval still ask.",
};

type ActiveSelector = "model" | "reasoning" | "approval" | null;
type ThreadMenuState = {
  sessionId: string;
  top: number;
  left: number;
} | null;

type OptimisticTurn = {
  threadId: string;
  userMessage: {
    id: string;
    role: "user";
    body: string;
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

const formatAttachmentSummary = (count: number) => (count === 1 ? "Attached 1 image." : `Attached ${count} images.`);

const buildUserBubbleMessage = (body: string, attachments: AssistantGatewayAttachment[]) => {
  const trimmedBody = body.trim();

  if (!attachments.length) {
    return trimmedBody;
  }

  const summary = formatAttachmentSummary(attachments.length);
  return trimmedBody ? `${trimmedBody}\n\n${summary}` : summary;
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

const toImageAttachment = async (file: File): Promise<AssistantGatewayAttachment> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("The chat currently supports image attachments only.");
  }

  if (file.size > maxImageAttachmentBytes) {
    throw new Error(`${file.name} exceeds the 6 MB limit for a single image.`);
  }

  return {
    id: `attachment-${file.name}-${file.lastModified.toString(36)}-${file.size.toString(36)}`,
    kind: "image",
    name: file.name,
    mimeType: file.type,
    dataUrl: await readFileAsDataUrl(file),
  };
};

const buildStateActions = (state: AssistantChatSessionState | null) => {
  if (!state) {
    return [];
  }

  const actions: Array<{ label: string; to: string }> = [];

  if (state.tone !== "sending") {
    actions.push({ label: "Open runs", to: "/agents/runs" });
  }

  if (state.routedAgentId) {
    actions.push({
      label: "View agent",
      to: `/agents/mission-control?agent=${encodeURIComponent(state.routedAgentId)}`,
    });
  }

  return actions;
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

const resolveApprovalSummary = (state: AssistantChatSessionState) => {
  if (state.approvalDecision === "denied") {
    return "Denied. This supervised draft stops here and nothing executes.";
  }

  if (state.approvalDecision === "approved_for_session") {
    return "Approved for this session. Similar follow-ups in this thread can continue without asking again for this specialist.";
  }

  return "Approved. This draft can continue under supervision, but the command layer still does not execute automatically.";
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
  const location = useLocation();
  const navigate = useNavigate();
  const { items } = useCompareTray();
  const {
    activeSession,
    compareTrayVisible,
    createSession,
    close,
    deleteSession,
    isOpen,
    open,
    sendTurn,
    refresh,
    selectSession,
    sessions,
    setCompareTrayVisible,
    updateSessionApprovalMode,
    toggle,
  } = useAssistantChat();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState("GPT-5.4");
  const [selectedReasoning, setSelectedReasoning] = useState("High");
  const [selectedApproval, setSelectedApproval] = useState<AssistantApprovalPreference>("supervised");
  const [attachments, setAttachments] = useState<AssistantGatewayAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [activeSelector, setActiveSelector] = useState<ActiveSelector>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [threadMenuState, setThreadMenuState] = useState<ThreadMenuState>(null);
  const [expandedMessageDetails, setExpandedMessageDetails] = useState<Record<string, boolean>>({});
  const [optimisticTurn, setOptimisticTurn] = useState<OptimisticTurn | null>(null);
  const [optimisticAssistantMessage, setOptimisticAssistantMessage] = useState<OptimisticAssistantMessage | null>(null);
  const [reviewingRunId, setReviewingRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const resolvedActiveSession = useMemo(
    () => buildOptimisticSession(activeSession, optimisticTurn, optimisticAssistantMessage),
    [activeSession, optimisticAssistantMessage, optimisticTurn],
  );
  const activeSessionState = resolvedActiveSession.latestState;
  const stateActions = useMemo(() => buildStateActions(activeSessionState), [activeSessionState]);
  const threadMenuSession = useMemo(
    () => sessions.find((session) => session.id === threadMenuState?.sessionId) ?? null,
    [sessions, threadMenuState?.sessionId],
  );

  useEffect(() => {
    setCompareTrayVisible(items.length > 0);
  }, [items.length, setCompareTrayVisible]);

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

      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeSelector, close, isOpen, threadMenuState]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 170)}px`;
  }, [isOpen, message]);

  useEffect(() => {
    setMessage("");
    setAttachments([]);
    setAttachmentError(null);
    setActionError(null);
    setActiveSelector(null);
    setThreadMenuState(null);
    setExpandedMessageDetails({});
    setOptimisticAssistantMessage(null);
    setSelectedApproval(activeSession.preferredApprovalMode);

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, [activeSession.preferredApprovalMode, resolvedActiveSession.id]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === expandedSessionId)) {
      setExpandedSessionId(null);
    }
  }, [expandedSessionId, sessions]);

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
      return;
    }

    const nextFrame = window.requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({
        block: "end",
        behavior: resolvedActiveSession.messages.length > 1 || Boolean(resolvedActiveSession.latestState) ? "smooth" : "auto",
      });
    });

    return () => window.cancelAnimationFrame(nextFrame);
  }, [isOpen, resolvedActiveSession.id, resolvedActiveSession.latestState, resolvedActiveSession.messages.length]);

  const handleSend = async () => {
    const nextMessage = message.trim();

    if ((!nextMessage && !attachments.length) || isSending) {
      return;
    }

    const sessionId = activeSession.id;
    const intentLabel = deriveIntentLabel(location.pathname);
    const outgoingUserMessage = buildUserBubbleMessage(nextMessage, attachments);
    const pendingState = {
      tone: "sending",
      label: "Supervisor reviewing request",
      body: "Routing intent and preparing a supervised response. No changes have been made.",
      routedAgentId: null,
      routedAgentName: "Supervisor Agent",
      intentLabel,
      commandStateLabel: "No changes applied",
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
      },
      state: pendingState,
    });

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }

    setIsSending(true);

    try {
      await sendTurn({
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
        },
      });
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Mission Control could not prepare this draft run.",
      );
    } finally {
      setOptimisticTurn(null);
      setIsSending(false);
    }
  };

  const handleReviewRun = async (runId: string, decision: "approve" | "deny" | "approve_for_session") => {
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
              ? "Understood. I am continuing this approved work for the whole session."
              : "Understood. I am continuing this approved work under supervision.",
          state: {
            tone: "sending",
            label: decision === "approve_for_session" ? "Continuing approved work for this session" : "Continuing approved work",
            body:
              decision === "approve_for_session"
                ? "Using your session approval to continue the delegated work without asking again in this thread."
                : "Applying your approval and waiting for the delegated work to finish.",
            routedAgentId: resolvedActiveSession.lastRoutedAgentId,
            routedAgentName: activeSessionState?.routedAgentName ?? "Supervisor Agent",
            intentLabel: "Approval decision recorded",
            commandStateLabel: "No changes applied",
            draftRunId: runId,
            approvalDecision: decision === "approve_for_session" ? "approved_for_session" : "approved",
            approvalScope: decision === "approve_for_session" ? "session" : "run",
          },
        },
      });
    }

    try {
      await reviewAgentRun({
        commandId: `cmd-chat-review-${Date.now().toString(36)}`,
        workspaceId,
        runId,
        decision,
      });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "I could not record that decision yet.");
    } finally {
      setOptimisticAssistantMessage(null);
      setReviewingRunId(null);
    }
  };

  const handleApprovalPreferenceChange = async (nextValue: AssistantApprovalPreference) => {
    setSelectedApproval(nextValue);
    await updateSessionApprovalMode(resolvedActiveSession.id, nextValue);
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
      setAttachmentError(`You can attach up to ${maxImageAttachments} images per message.`);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      return;
    }

    const nextFiles = files.slice(0, availableSlots);

    try {
      const nextAttachments = await Promise.all(nextFiles.map((file) => toImageAttachment(file)));
      setAttachments((current) => [...current, ...nextAttachments]);
      setAttachmentError(
        files.length > nextFiles.length ? `Only ${availableSlots} images were attached to keep this message lightweight.` : null,
      );
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "I could not attach that image.");
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

    const menuWidth = 156;
    const menuHeight = 142;
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

  return (
    <div
      ref={shellRef}
      className={`assistant-shell${compareTrayVisible ? " assistant-shell-with-compare" : ""}${isOpen ? " is-open" : ""}`}
    >
      {isOpen ? (
        <section
          ref={panelRef}
          className={`assistant-chat-panel${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
          aria-label="Global assistant chat"
        >
          <aside className="assistant-chat-sidebar">
            <div className="assistant-chat-sidebar-header">
              <div>
                <strong className="assistant-chat-sidebar-title">Threads</strong>
              </div>
              <div className="assistant-chat-sidebar-tools">
                <button
                  aria-label="Create new chat thread"
                  className="assistant-chat-sidebar-tool"
                  onClick={() => void createSession()}
                  type="button"
                >
                  <Plus size={16} />
                </button>
                <button
                  aria-label="Collapse threads sidebar"
                  className="assistant-chat-sidebar-tool"
                  onClick={() => setIsSidebarCollapsed(true)}
                  type="button"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>

            <div className="assistant-chat-session-list">
              {sessions.map((session) => {
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
                      <button className="assistant-chat-session-select" onClick={() => void selectSession(session.id)} type="button">
                        <div className="assistant-chat-session-copy">
                          <strong>{session.title}</strong>
                        </div>
                      </button>

                      <div className="assistant-chat-session-actions">
                        <button
                          aria-label={isExpanded ? "Hide thread details" : "Show thread details"}
                          className={`assistant-chat-session-action${isExpanded ? " is-open" : ""}`}
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
                          <span>Context</span>
                          <strong>{session.contextLabel}</strong>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>Assigned</span>
                          <strong>{hasState ? session.latestState?.routedAgentName ?? "Supervisor Agent" : "Not routed yet"}</strong>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>Intent</span>
                          <strong>{hasState ? session.latestState?.intentLabel ?? "Pending classification" : "Pending classification"}</strong>
                        </div>
                        <div className="assistant-chat-session-detail-row">
                          <span>Command</span>
                          <strong>
                            {hasState ? session.latestState?.commandStateLabel ?? "No changes applied" : "No changes applied"}
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
                    aria-label="Expand threads sidebar"
                    className="surface-card-action"
                    onClick={() => setIsSidebarCollapsed(false)}
                    type="button"
                  >
                    <PanelLeftOpen size={16} />
                  </button>
                ) : null}
                <div className="assistant-chat-context-pill">{resolvedActiveSession.contextLabel}</div>
              </div>
              <button aria-label="Close assistant chat" className="surface-card-action" onClick={close} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="assistant-chat-thread">
              {resolvedActiveSession.messages.map((entry) => {
                if (entry.role === "user") {
                  return (
                    <div key={entry.id} className="assistant-chat-message-block assistant-chat-message-block-user">
                      <div className="assistant-chat-bubble assistant-chat-bubble-user">{entry.body}</div>
                    </div>
                  );
                }

                const messageState = entry.state ?? null;
                const isExpanded = expandedMessageDetails[entry.id] ?? false;
                const messageActions = buildStateActions(messageState);
                const needsApproval = Boolean(messageState?.draftRunId && messageState.approvalDecision === "pending");
                const approvalResolved = Boolean(
                  messageState?.draftRunId &&
                    messageState.approvalDecision &&
                    messageState.approvalDecision !== "pending",
                );

                return (
                  <div key={entry.id} className="assistant-chat-message-block assistant-chat-message-block-assistant">
                    <div className="assistant-chat-message-meta">
                      <span className={`assistant-chat-speaker-pill${messageState ? ` assistant-chat-speaker-pill-${messageState.tone}` : ""}`}>
                        {messageState?.routedAgentName ?? "Supervisor Agent"}
                      </span>
                      {messageState ? (
                        <button
                          aria-label={isExpanded ? "Hide response details" : "Show response details"}
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

                    <div className="assistant-chat-bubble assistant-chat-bubble-assistant">{entry.body}</div>

                    {needsApproval && messageState?.draftRunId ? (
                      <div className="assistant-chat-approval-card">
                        <div className="assistant-chat-approval-copy">
                          <span className="assistant-chat-approval-eyebrow">Approval required</span>
                          <strong>Choose how you want to handle this supervised draft.</strong>
                          <p>{messageState.approvalReason ?? "No real execution happens here yet. This only records your decision cleanly in the flow."}</p>
                        </div>
                        <div className="assistant-chat-approval-actions">
                          <button
                            className="primary-control"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "approve")}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="surface-card-action-text"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "approve_for_session")}
                            type="button"
                          >
                            Approve for this session
                          </button>
                          <button
                            className="surface-card-action-text assistant-chat-approval-deny"
                            disabled={reviewingRunId === messageState.draftRunId}
                            onClick={() => void handleReviewRun(messageState.draftRunId ?? "", "deny")}
                            type="button"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {approvalResolved && messageState ? (
                      <div className={`assistant-chat-approval-result ${resolveApprovalToneClass(messageState.approvalDecision)}`}>
                        <span className="assistant-chat-approval-result-pill">
                          {messageState.approvalDecision?.replace(/_/g, " ")}
                        </span>
                        <p>{resolveApprovalSummary(messageState)}</p>
                      </div>
                    ) : null}

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
                    <span className="assistant-chat-inline-thinking-label">Supervisor thinking</span>
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
                  aria-label={isSending ? "Routing message" : "Send message"}
                  className="assistant-chat-send-button"
                  disabled={isSending || (!message.trim() && !attachments.length)}
                  onClick={handleSend}
                  type="button"
                >
                  <ArrowUp size={18} />
                </button>
              </div>

              <input
                ref={attachmentInputRef}
                accept="image/*"
                className="assistant-chat-file-input"
                multiple
                onChange={handleAttachmentSelection}
                type="file"
              />

              {attachments.length ? (
                <div className="assistant-chat-attachments">
                  {attachments.map((attachment) => (
                    <span key={attachment.id} className="assistant-chat-attachment-chip">
                      <span>{attachment.name}</span>
                      <button
                        aria-label={`Remove ${attachment.name}`}
                        className="assistant-chat-attachment-remove"
                        onClick={() => {
                          setAttachments((current) => current.filter((item) => item.id !== attachment.id));
                          setAttachmentError(null);
                        }}
                        type="button"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {attachmentError ? <p className="assistant-chat-attachment-error">{attachmentError}</p> : null}

              <div className="assistant-chat-controls-row">
                <button className="assistant-chat-control-link" onClick={() => attachmentInputRef.current?.click()} type="button">
                  <Paperclip size={14} />
                  <span>Add</span>
                </button>

                <div className="assistant-chat-selector">
                  <button
                    className={`assistant-chat-control-link${activeSelector === "model" ? " is-open" : ""}`}
                    onClick={() => setActiveSelector((current) => (current === "model" ? null : "model"))}
                    type="button"
                  >
                    <span>{selectedModel}</span>
                    <ChevronDown size={14} />
                  </button>
                  {activeSelector === "model" ? (
                    <div className="assistant-chat-selector-popover">
                      {modelOptions.map((option) => (
                        <button
                          key={option}
                          className={`assistant-chat-selector-option${selectedModel === option ? " is-selected" : ""}`}
                          onClick={() => {
                            setSelectedModel(option);
                            setActiveSelector(null);
                          }}
                          type="button"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="assistant-chat-selector">
                  <button
                    className={`assistant-chat-control-link${activeSelector === "reasoning" ? " is-open" : ""}`}
                    onClick={() => setActiveSelector((current) => (current === "reasoning" ? null : "reasoning"))}
                    type="button"
                  >
                    <span>{selectedReasoning}</span>
                    <ChevronDown size={14} />
                  </button>
                  {activeSelector === "reasoning" ? (
                    <div className="assistant-chat-selector-popover">
                      {reasoningOptions.map((option) => (
                        <button
                          key={option}
                          className={`assistant-chat-selector-option${selectedReasoning === option ? " is-selected" : ""}`}
                          onClick={() => {
                            setSelectedReasoning(option);
                            setActiveSelector(null);
                          }}
                          type="button"
                        >
                          {option}
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
                    <span>{approvalOptions.find((option) => option.value === selectedApproval)?.label ?? "Supervised"}</span>
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
                          {option.label}
                        </button>
                      ))}
                      <p className="assistant-chat-selector-helper">
                        {approvalModeDescriptions[selectedApproval]}
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
                  Open runs
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
                  View agent
                </button>
              ) : null}
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
        </section>
      ) : null}

      <button aria-label="Open global assistant" className="assistant-chat-fab" onClick={toggle} type="button">
        <Bot size={24} />
      </button>
    </div>
  );
};
