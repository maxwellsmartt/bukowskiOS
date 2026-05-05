import { useMemo, useState } from "react";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { getAgentApprovalDecisionLabel, getAgentRunStatusLabel } from "@shared/labels/statusLabels";

import { reviewAgentRun, useAgentRuns } from "./useAgentsData";

export const AgentRunsPage = () => {
  const { activeWorkspaceId: workspaceId, isWorkspaceReady } = useWorkspace();
  const { data, error } = useAgentRuns();
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_approval" | "queued" | "running" | "done">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const summaryCards = useMemo(
    () => [
      { label: "Queued", value: data.filter((run) => run.status === "queued").length, filter: "queued" as const },
      {
        label: "Needs approval",
        value: data.filter((run) => run.status === "needs_approval").length,
        filter: "needs_approval" as const,
      },
      {
        label: "Running",
        value: data.filter((run) => run.status === "running" || run.status === "routing").length,
        filter: "running" as const,
      },
      { label: "Done", value: data.filter((run) => run.status === "done").length, filter: "done" as const },
    ],
    [data],
  );

  const agentOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; label: string }> = [];
    for (const run of data) {
      const id = run.agentId ?? "supervisor";
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, label: run.agentDisplayName || "Supervisor Agent" });
    }
    return list.sort((left, right) => left.label.localeCompare(right.label));
  }, [data]);

  const filteredRuns = useMemo(() => {
    return data.filter((run) => {
      if (statusFilter === "running") {
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
      setFeedback(getUserFacingErrorMessage(nextError, "I could not record that decision."));
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="Activity" titleTone="accent" />

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

      <SurfaceCard title="Recent Activity">
        <div className="agent-runs-filter-row">
          <label className="agent-runs-filter">
            <span>Status</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              value={statusFilter}
            >
              <option value="all">All</option>
              <option value="needs_approval">Needs approval</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label className="agent-runs-filter">
            <span>Agent</span>
            <select onChange={(event) => setAgentFilter(event.target.value)} value={agentFilter}>
              <option value="all">All agents</option>
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
              Clear filters
            </button>
          ) : null}
        </div>

        {error ? <div className="empty-state">Runs unavailable: {error}</div> : null}
        {feedback ? <div className="form-inline-error">{feedback}</div> : null}

        <div className="agent-support-list">
          {filteredRuns.length === 0 && !error ? (
            <div className="empty-state">No runs match these filters yet.</div>
          ) : null}
          {filteredRuns.map((run) => (
            <div key={run.id} className="agent-run-row">
              <div className="agent-run-row-copy">
                <strong>{run.title}</strong>
                <p>{run.summary}</p>
                <p className="agent-run-note">{run.agentDisplayName || "Supervisor Agent"} · No changes yet</p>
                {run.status === "needs_approval" ? (
                  <div className="agent-run-approval-panel">
                    <div className="agent-run-approval-copy">
                      <strong>Approval required</strong>
                      <p>{run.approvalReason ?? "Review this supervised draft here before anything moves forward."}</p>
                    </div>
                    <div className="agent-run-approval-actions">
                      <button
                        className="primary-control"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReview(run.id, "approve")}
                        type="button"
                      >
                        Approve
                      </button>
                      {run.threadId ? (
                        <button
                          className="surface-card-action-text"
                          disabled={processingRunId === run.id}
                          onClick={() => void handleReview(run.id, "approve_for_session")}
                          type="button"
                        >
                          Approve for this session
                        </button>
                      ) : null}
                      <button
                        className="surface-card-action-text is-danger"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReview(run.id, "deny")}
                        type="button"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="agent-run-row-meta">
                <span className={`run-status-pill run-status-pill-${run.status}`}>{getAgentRunStatusLabel(run.status)}</span>
                {run.approvalDecision && run.approvalDecision !== "pending" ? (
                  <span className={`run-status-pill run-status-pill-${run.approvalDecision}`}>
                    {getAgentApprovalDecisionLabel(run.approvalDecision)}
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
