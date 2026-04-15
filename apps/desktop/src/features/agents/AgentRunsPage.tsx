import { useMemo, useState } from "react";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getAgentApprovalDecisionLabel, getAgentRunStatusLabel } from "@shared/labels/statusLabels";

import { reviewAgentRun, useAgentRuns } from "./useAgentsData";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

export const AgentRunsPage = () => {
  const { data, error } = useAgentRuns();
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const summaryCards = useMemo(
    () => [
      { label: "Queued", value: data.filter((run) => run.status === "queued").length },
      {
        label: "Needs approval",
        value: data.filter((run) => run.status === "needs_approval").length,
      },
      { label: "Running", value: data.filter((run) => run.status === "running" || run.status === "routing").length },
      { label: "Done", value: data.filter((run) => run.status === "done").length },
    ],
    [data],
  );

  const handleReview = async (runId: string, decision: "approve" | "deny" | "approve_for_session") => {
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
      setFeedback(nextError instanceof Error ? nextError.message : "I could not record that decision.");
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="Activity" titleTone="accent" />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <SurfaceCard title="Recent Activity">
        {error ? <div className="empty-state">Runs unavailable: {error}</div> : null}
        {feedback ? <div className="form-inline-error">{feedback}</div> : null}

        <div className="agent-support-list">
          {data.map((run) => (
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
