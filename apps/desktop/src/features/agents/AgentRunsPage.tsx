import { useMemo, useState } from "react";
import { ExternalLink, MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAssistantChat } from "@app/providers/AssistantChatContext";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { getAgentApprovalDecisionLabel, getAgentRunStatusLabel } from "@shared/labels/statusLabels";

import { reviewAgentRun, useAgentRuns } from "./useAgentsData";

export const AgentRunsPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId: workspaceId, isWorkspaceReady } = useWorkspace();
  const { selectSession } = useAssistantChat();
  const { data, error } = useAgentRuns({ workspaceId });
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_attention" | "needs_approval" | "queued" | "running" | "done">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const summaryCards = useMemo(
    () => [
      {
        label: t("agents.runs.summary.needsAttention"),
        value: data.filter((run) => run.operationalReceipt?.blocked.length || run.status === "failed").length,
        filter: "needs_attention" as const,
      },
      {
        label: t("agents.runs.summary.needsApproval"),
        value: data.filter((run) => run.status === "needs_approval").length,
        filter: "needs_approval" as const,
      },
      {
        label: t("agents.runs.summary.running"),
        value: data.filter((run) => run.status === "running" || run.status === "routing").length,
        filter: "running" as const,
      },
      { label: t("agents.runs.summary.done"), value: data.filter((run) => run.status === "done").length, filter: "done" as const },
    ],
    [data, t],
  );

  const agentOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; label: string }> = [];
    for (const run of data) {
      const id = run.agentId ?? "supervisor";
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, label: run.agentDisplayName || t("agents.runs.supervisorAgent") });
    }
    return list.sort((left, right) => left.label.localeCompare(right.label));
  }, [data, t]);

  const filteredRuns = useMemo(() => {
    return data.filter((run) => {
      if (statusFilter === "needs_attention") {
        if (!run.operationalReceipt?.blocked.length && run.status !== "failed") return false;
      } else if (statusFilter === "running") {
        if (run.status !== "running" && run.status !== "routing") return false;
      } else if (statusFilter !== "all" && run.status !== statusFilter) {
        return false;
      }
      if (agentFilter !== "all") {
        const id = run.agentId ?? "supervisor";
        if (id !== agentFilter) return false;
      }
      return true;
    });
  }, [agentFilter, data, statusFilter]);

  const openRunThread = async (threadId: string | null) => {
    if (!threadId) {
      return;
    }

    await selectSession(threadId);
  };

  const handleReview = async (runId: string, decision: "approve" | "deny" | "approve_for_session") => {
    if (!isWorkspaceReady) {
      return;
    }

    setProcessingRunId(runId);
    setFeedback(null);

    try {
      const result = await reviewAgentRun({
        commandId: `cmd-run-review-${Date.now().toString(36)}`,
        workspaceId,
        runId,
        decision,
      });
      setFeedback(result.summary);
    } catch (nextError) {
      setFeedback(getUserFacingErrorMessage(nextError, t("agents.runs.errors.reviewDecision")));
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("agents.runs.title")} titleTone="accent" />

      <div className="agents-health-grid">
        {summaryCards.map((card) => {
          const isActive = statusFilter === card.filter;
          return (
            <button
              key={card.label}
              aria-pressed={isActive}
              className={`agents-health-card agents-health-card-button${isActive ? " is-active" : ""}`}
              onClick={() => setStatusFilter(isActive ? "all" : card.filter)}
              type="button"
            >
              <span className="agents-health-label">{card.label}</span>
              <strong className="agents-health-value">{card.value}</strong>
            </button>
          );
        })}
      </div>

      <SurfaceCard title={t("agents.runs.recentActivity")}>
        <div className="agent-runs-filter-row">
          <label className="agent-runs-filter">
            <span>{t("agents.runs.filters.status")}</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              value={statusFilter}
            >
              <option value="all">{t("agents.runs.filters.all")}</option>
              <option value="needs_attention">{t("agents.runs.summary.needsAttention")}</option>
              <option value="needs_approval">{t("agents.runs.summary.needsApproval")}</option>
              <option value="queued">{t("agents.runs.status.queued")}</option>
              <option value="running">{t("agents.runs.summary.running")}</option>
              <option value="done">{t("agents.runs.summary.done")}</option>
            </select>
          </label>
          <label className="agent-runs-filter">
            <span>{t("agents.runs.filters.agent")}</span>
            <select onChange={(event) => setAgentFilter(event.target.value)} value={agentFilter}>
              <option value="all">{t("agents.runs.filters.allAgents")}</option>
              {agentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {statusFilter !== "all" || agentFilter !== "all" ? (
            <button
              className="ghost-control"
              onClick={() => {
                setStatusFilter("all");
                setAgentFilter("all");
              }}
              type="button"
            >
              {t("agents.runs.filters.clear")}
            </button>
          ) : null}
        </div>

        {error ? <div className="empty-state">{t("agents.runs.unavailable", { message: error })}</div> : null}
        {feedback ? <div className="form-inline-error">{feedback}</div> : null}

        <div className="agent-support-list">
          {filteredRuns.length === 0 && !error ? (
            <div className="empty-state">{t("agents.runs.emptyFiltered")}</div>
          ) : null}
          {filteredRuns.map((run) => (
            <div key={run.id} className="agent-run-row">
              <div className="agent-run-row-copy">
                <strong>{run.title}</strong>
                <p>{run.summary}</p>
                <p className="agent-run-note">
                  {run.agentDisplayName || t("agents.runs.supervisorAgent")} · {run.updatedAtLabel}
                </p>
                {run.operationalReceipt ? (
                  <div className="agent-run-receipt">
                    <div className="agent-run-receipt-header">
                      <span>{t("agents.runs.operationalReceipt")}</span>
                      <strong>{run.operationalReceipt.summary}</strong>
                    </div>
                    {[...run.operationalReceipt.blocked, ...run.operationalReceipt.pending, ...run.operationalReceipt.completed]
                      .slice(0, 4)
                      .map((item, index) => (
                        <div key={`${run.id}:${item.status}:${item.label}:${index}`} className="agent-run-receipt-row">
                          <span className={`assistant-chat-receipt-dot assistant-chat-receipt-dot-${item.status}`} />
                          <div>
                            <strong>{item.label}</strong>
                            {item.detail ? <p>{item.detail}</p> : null}
                          </div>
                        </div>
                      ))}
                    {run.operationalReceipt.nextSteps[0] ? (
                      <p className="agent-run-receipt-next">{t("agents.runs.nextStep", { step: run.operationalReceipt.nextSteps[0] })}</p>
                    ) : null}
                  </div>
                ) : null}
                {run.actionLinks.length || run.threadId ? (
                  <div className="agent-run-action-row">
                    {run.threadId ? (
                      <button
                        className="surface-card-action-text"
                        onClick={() => void openRunThread(run.threadId)}
                        type="button"
                      >
                        <MessageSquareText size={14} />
                        {t("agents.runs.continueInChat")}
                      </button>
                    ) : null}
                    {run.actionLinks.map((link) => (
                      <button
                        key={`${run.id}:${link.entityType}:${link.entityId}`}
                        className="surface-card-action-text"
                        onClick={() => navigate(link.path)}
                        type="button"
                      >
                        <span>{link.label}</span>
                        <ExternalLink size={13} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {run.status === "needs_approval" ? (
                  <div className="agent-run-approval-panel">
                    <div className="agent-run-approval-copy">
                      <strong>{t("agents.runs.approvalRequired")}</strong>
                      <p>{run.approvalReason ?? t("agents.runs.approvalFallback")}</p>
                    </div>
                    <div className="agent-run-approval-actions">
                      <button
                        className="primary-control"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReview(run.id, "approve")}
                        type="button"
                      >
                        {t("agents.runs.approve")}
                      </button>
                      {run.threadId ? (
                        <button
                          className="surface-card-action-text"
                          disabled={processingRunId === run.id}
                          onClick={() => void handleReview(run.id, "approve_for_session")}
                          type="button"
                        >
                          {t("agents.runs.approveForSession")}
                        </button>
                      ) : null}
                      <button
                        className="surface-card-action-text is-danger"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReview(run.id, "deny")}
                        type="button"
                      >
                        {t("agents.runs.deny")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="agent-run-row-meta">
                <span className={`run-status-pill run-status-pill-${run.status}`}>
                  {t(`agents.runs.status.${run.status}`, { defaultValue: getAgentRunStatusLabel(run.status) })}
                </span>
                {run.approvalDecision && run.approvalDecision !== "pending" ? (
                  <span className={`run-status-pill run-status-pill-${run.approvalDecision}`}>
                    {t(`agents.runs.approvalDecision.${run.approvalDecision}`, {
                      defaultValue: getAgentApprovalDecisionLabel(run.approvalDecision),
                    })}
                  </span>
                ) : null}
                <span className="agent-run-time">{run.updatedAtLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};
