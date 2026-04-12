import { useMemo, useState } from "react";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { reviewAgentRun, useAgentRuns } from "./useAgentsData";

const workspaceId = "workspace-metadata";

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
      setFeedback(nextError instanceof Error ? nextError.message : "No pude registrar esa decisión.");
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Runs"
        titleTone="accent"
        body="Intent classification, supervised drafts and routing stay visible here before any real command execution."
      />

      <SurfaceCard
        title="Command visibility"
        subtitle="These runs show orchestration state only. A run can be classified, routed or approved here without the Bukowski command layer executing yet."
      >
        <p className="agent-run-note">Intent classified first. Command execution remains outside this phase.</p>
      </SurfaceCard>

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <SurfaceCard title="Recent runs" subtitle="Queued, supervised and completed work stays visible in one place.">
        {error ? <div className="empty-state">Runs unavailable: {error}</div> : null}
        {feedback ? <div className="form-inline-error">{feedback}</div> : null}

        <div className="agent-support-list">
          {data.map((run) => (
            <div key={run.id} className="agent-run-row">
              <div className="agent-run-row-copy">
                <strong>{run.title}</strong>
                <p>{run.summary}</p>
                <p className="agent-run-note">
                  Intent classified · {run.agentDisplayName || "Supervisor Agent"} · Command layer still not executed
                </p>
                {run.status === "needs_approval" ? (
                  <div className="agent-run-approval-panel">
                    <div className="agent-run-approval-copy">
                      <strong>Approval required</strong>
                      <p>Review this supervised draft here before anything moves forward.</p>
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
                <span className={`run-status-pill run-status-pill-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
                {run.approvalDecision && run.approvalDecision !== "pending" ? (
                  <span className={`run-status-pill run-status-pill-${run.approvalDecision}`}>
                    {run.approvalDecision.replace(/_/g, " ")}
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
