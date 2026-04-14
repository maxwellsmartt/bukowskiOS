import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, CircleAlert, PauseCircle, PlayCircle, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";

import { AgentWizardPanel } from "./AgentWizardPanel";
import { reviewAgentRun, setAgentApprovalMode, setAgentStatus, useAgentDetail, useMissionControlSnapshot } from "./useAgentsData";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const statusLabelMap = {
  active: "Active",
  paused: "Paused",
} as const;

const operationalStateLabelMap = {
  idle: "Idle",
  working: "Working",
  not_working: "Not working",
} as const;

export const AgentsMissionControlPage = () => {
  const { data, error, reload } = useMissionControlSnapshot();
  const [searchParams] = useSearchParams();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "needs_approval" | "running" | "done">("all");
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState({
    queue: false,
    activity: false,
    models: true,
    connectors: true,
  });
  const { data: detail, reload: reloadDetail } = useAgentDetail(selectedAgentId);

  useVisiblePolling(
    () => {
      reload();
      if (selectedAgentId) {
        reloadDetail();
      }
    },
    { intervalMs: 2000 },
  );

  useEffect(() => {
    const focusedAgentId = searchParams.get("agent");

    if (!focusedAgentId) {
      return;
    }

    const exists =
      data.supervisor?.id === focusedAgentId || data.subagents.some((agent) => agent.id === focusedAgentId);

    if (exists) {
      setSelectedAgentId(focusedAgentId);
    }
  }, [data.subagents, data.supervisor, searchParams]);

  const selectedAgent = detail.agent;
  const healthCards = useMemo(
    () => [
      { label: "Active agents", value: data.health.activeAgents },
      { label: "Paused agents", value: data.health.pausedAgents },
      { label: "Recent runs", value: data.health.recentRuns },
      { label: "Configured connectors", value: data.health.connectorsConfigured },
      { label: "Assigned models", value: data.health.modelsAssigned },
    ],
    [data.health],
  );

  const filteredQueue = useMemo(() => {
    if (queueFilter === "all") {
      return data.queue;
    }

    return data.queue.filter((run) => run.status === queueFilter);
  }, [data.queue, queueFilter]);
  const pendingApprovals = useMemo(() => data.queue.filter((run) => run.status === "needs_approval"), [data.queue]);

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const handleToggleStatus = async () => {
    if (!selectedAgent) {
      return;
    }

    await setAgentStatus({
      commandId: `cmd-agent-status-${Date.now().toString(36)}`,
      workspaceId,
      id: selectedAgent.id,
      status: selectedAgent.status === "active" ? "paused" : "active",
    });
  };

  const handleApprovalModeCycle = async () => {
    if (!selectedAgent) {
      return;
    }

    const nextMode =
      selectedAgent.approvalMode === "auto"
        ? "supervised"
        : selectedAgent.approvalMode === "supervised"
          ? "needs_approval"
          : "auto";

    await setAgentApprovalMode({
      commandId: `cmd-agent-approval-${Date.now().toString(36)}`,
      workspaceId,
      id: selectedAgent.id,
      approvalMode: nextMode,
    });
  };

  const handleReviewRun = async (runId: string, decision: "approve" | "deny" | "approve_for_session") => {
    setProcessingRunId(runId);
    setApprovalFeedback(null);

    try {
      const result = await reviewAgentRun({
        commandId: `cmd-mission-review-${Date.now().toString(36)}`,
        workspaceId,
        runId,
        decision,
      });
      setApprovalFeedback(result.summary);
      reload();
      if (selectedAgentId) {
        reloadDetail();
      }
    } catch (error) {
      setApprovalFeedback(error instanceof Error ? error.message : "I could not record that decision.");
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Mission Control"
        titleTone="accent"
        body="Monitor agents, activity, and pending work from a clearer control view."
      />

      {error ? <div className="empty-state">Mission Control unavailable: {error}</div> : null}
      {approvalFeedback ? <div className="form-inline-error">{approvalFeedback}</div> : null}

      <div className="agents-health-grid">
        {healthCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className={`agents-mission-layout${selectedAgent ? "" : " is-graph-expanded"}`}>
        <SurfaceCard
          className="agents-graph-card"
          title="Mission graph"
          subtitle="Supervisor arriba, especialistas abajo."
        >
          <div className="mission-graph">
            {data.supervisor ? (
              <button
                className={`mission-node mission-node-root mission-node-operational-${data.supervisor.operationalState}${
                  selectedAgentId === data.supervisor.id ? " is-selected" : ""
                }`}
                onClick={() => setSelectedAgentId(data.supervisor?.id ?? null)}
                type="button"
              >
                <div className="mission-node-topline">
                  <span className="mission-node-emoji">{data.supervisor.emoji}</span>
                  <span className="mission-node-name" title={data.supervisor.displayName}>
                    {data.supervisor.displayName}
                  </span>
                </div>
                <span className="mission-node-role mission-node-role-clamped">{data.supervisor.role}</span>
                <div className="mission-node-footer">
                  <span className={`mission-operational-pill mission-operational-pill-${data.supervisor.operationalState}`}>
                    {operationalStateLabelMap[data.supervisor.operationalState]}
                  </span>
                  <span className={`mission-node-status mission-node-status-${data.supervisor.status}`}>
                    {statusLabelMap[data.supervisor.status]}
                  </span>
                </div>
              </button>
            ) : null}

            <div className="mission-graph-spine" />

            <div className="mission-graph-band">
              {data.subagents.map((agent) => (
                <div key={agent.id} className="mission-graph-branch">
                  <div className="mission-graph-branch-line" />
                  <button
                    className={`mission-node mission-node-operational-${agent.operationalState}${
                      selectedAgentId === agent.id ? " is-selected" : ""
                    }`}
                    onClick={() => setSelectedAgentId(agent.id)}
                    type="button"
                  >
                    <div className="mission-node-topline">
                      <span className="mission-node-emoji">{agent.emoji}</span>
                      <span className="mission-node-name" title={agent.displayName}>
                        {agent.displayName}
                      </span>
                    </div>
                    <span className="mission-node-role mission-node-role-clamped">{agent.role}</span>
                    <div className="mission-node-footer">
                      <span className={`mission-operational-pill mission-operational-pill-${agent.operationalState}`}>
                        {operationalStateLabelMap[agent.operationalState]}
                      </span>
                      <span className={`mission-node-status mission-node-status-${agent.status}`}>
                        {statusLabelMap[agent.status]}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </SurfaceCard>

        {selectedAgent ? (
          <SurfaceCard
            className="agents-detail-card"
            title={selectedAgent.displayName}
            subtitle={selectedAgent.role}
            aside={
              <div className="surface-card-actions">
                <button className="ghost-control mission-control-configure" onClick={() => setEditorOpen(true)} type="button">
                  Configure
                </button>
                <button
                  aria-label="Close agent detail"
                  className="surface-card-action"
                  onClick={() => setSelectedAgentId(null)}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            }
          >
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`mission-operational-pill mission-operational-pill-${selectedAgent.operationalState}`}>
                  {operationalStateLabelMap[selectedAgent.operationalState]}
                </span>
                <span className={`mission-node-status mission-node-status-${selectedAgent.status}`}>
                  {statusLabelMap[selectedAgent.status]}
                </span>
                <span className="subtle-pill">{selectedAgent.modelLabel}</span>
                <span className="subtle-pill">{selectedAgent.approvalMode.replace(/_/g, " ")}</span>
              </div>

              <div className="agent-detail-meta">
                <div>
                  <span className="agent-detail-kicker">Role</span>
                  <strong>{selectedAgent.role}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">Mission</span>
                  <strong>{selectedAgent.mission}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">Domain</span>
                  <strong>{selectedAgent.domain}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">Allowed tools</span>
                  <strong>{detail.tools.join(" · ") || "No tools assigned"}</strong>
                </div>
              </div>

              <div className="agent-detail-actions">
                <button className="ghost-control" onClick={handleToggleStatus} type="button">
                  {selectedAgent.status === "active" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                  <span>{selectedAgent.status === "active" ? "Pause agent" : "Reactivate"}</span>
                </button>
                <button className="ghost-control" onClick={handleApprovalModeCycle} type="button">
                  <ShieldCheck size={14} />
                  <span>Cycle approval mode</span>
                </button>
              </div>

              <div className="agent-detail-runs">
                <span className="agent-detail-kicker">Recent runs</span>
                {detail.recentRuns.length ? (
                  detail.recentRuns.map((run) => (
                    <div key={run.id} className="agent-run-row">
                      <div>
                        <strong>{run.title}</strong>
                        <p>{run.summary}</p>
                      </div>
                      <span className={`run-status-pill run-status-pill-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No recent runs for this agent yet.</div>
                )}
              </div>
            </div>
          </SurfaceCard>
        ) : null}
      </div>

      {pendingApprovals.length ? (
        <SurfaceCard
          title="Pending approvals"
          subtitle={`${pendingApprovals.length} drafts are waiting for your review before anything can continue.`}
        >
          <div className="agent-support-list">
            {pendingApprovals.map((run) => (
              <div key={run.id} className="agent-run-row agent-run-row-pending">
                <div className="agent-run-row-copy">
                  <div className="agent-run-row-heading">
                    <strong>{run.title}</strong>
                    <span className={`run-status-pill run-status-pill-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
                  </div>
                  <p>{run.agentDisplayName}</p>
                  <p>{run.approvalReason ?? "This supervised draft is waiting for your review."}</p>
                  <div className="agent-run-approval-actions">
                    <button
                      className="primary-control"
                      disabled={processingRunId === run.id}
                      onClick={() => void handleReviewRun(run.id, "approve")}
                      type="button"
                    >
                      Approve
                    </button>
                    {run.threadId ? (
                      <button
                        className="surface-card-action-text"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReviewRun(run.id, "approve_for_session")}
                        type="button"
                      >
                        Approve for this session
                      </button>
                    ) : null}
                    <button
                      className="surface-card-action-text is-danger"
                      disabled={processingRunId === run.id}
                      onClick={() => void handleReviewRun(run.id, "deny")}
                      type="button"
                    >
                      Deny
                    </button>
                    <button
                      className="surface-card-action-text"
                      onClick={() => setSelectedAgentId(run.agentId ?? data.supervisor?.id ?? null)}
                      type="button"
                    >
                      View agent
                    </button>
                  </div>
                </div>
                <div className="agent-run-row-meta">
                  <span className="agent-run-time">{run.updatedAtLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <div className="agents-support-grid">
        <SurfaceCard
          className={collapsedSections.queue ? "is-collapsed" : ""}
          title="Run queue"
          subtitle={collapsedSections.queue ? undefined : "Trabajo reciente y drafts pendientes."}
          aside={
            <button className={`mission-section-toggle${collapsedSections.queue ? " is-collapsed" : ""}`} onClick={() => toggleSection("queue")} type="button">
              <ChevronDown size={14} />
            </button>
          }
        >
          {!collapsedSections.queue ? (
            <>
              <div className="agent-detail-row">
                <button className={`chip-button${queueFilter === "all" ? " is-active" : ""}`} onClick={() => setQueueFilter("all")} type="button">
                  All
                </button>
                <button
                  className={`chip-button${queueFilter === "needs_approval" ? " is-active" : ""}`}
                  onClick={() => setQueueFilter("needs_approval")}
                  type="button"
                >
                  Needs approval
                </button>
                <button
                  className={`chip-button${queueFilter === "running" ? " is-active" : ""}`}
                  onClick={() => setQueueFilter("running")}
                  type="button"
                >
                  Running
                </button>
                <button className={`chip-button${queueFilter === "done" ? " is-active" : ""}`} onClick={() => setQueueFilter("done")} type="button">
                  Done
                </button>
              </div>
              <div className="agent-support-list">
                {filteredQueue.map((run) => (
                  <button
                    key={run.id}
                    className="agent-run-row agent-run-row-button"
                    onClick={() => setSelectedAgentId(run.agentId ?? data.supervisor?.id ?? null)}
                    type="button"
                  >
                    <div>
                      <strong>{run.title}</strong>
                      <p>{run.status === "needs_approval" ? run.approvalReason ?? run.agentDisplayName : run.agentDisplayName}</p>
                    </div>
                    <div className="agent-run-row-meta">
                      <span className={`run-status-pill run-status-pill-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
                      <span className="agent-run-time">{run.updatedAtLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </SurfaceCard>

        <SurfaceCard
          className={collapsedSections.activity ? "is-collapsed" : ""}
          title="Activity feed"
          subtitle={collapsedSections.activity ? undefined : "Actividad reciente del sistema."}
          aside={
            <button className={`mission-section-toggle${collapsedSections.activity ? " is-collapsed" : ""}`} onClick={() => toggleSection("activity")} type="button">
              <ChevronDown size={14} />
            </button>
          }
        >
          {!collapsedSections.activity ? (
            <div className="agent-support-list agent-support-list-scroll">
              {data.activity.map((activity) => (
                <button
                  key={activity.id}
                  className="agent-activity-row agent-activity-row-button"
                  onClick={() => setSelectedAgentId(activity.agentId ?? data.supervisor?.id ?? null)}
                  type="button"
                >
                  <div className={`agent-activity-icon tone-${activity.tone}`}>
                    {activity.tone === "success" ? <ShieldCheck size={14} /> : activity.tone === "warning" ? <CircleAlert size={14} /> : <Bot size={14} />}
                  </div>
                  <div>
                    <strong>{activity.title}</strong>
                    <p>{activity.body}</p>
                    <span className="agent-activity-meta">
                      {activity.agentDisplayName} · {activity.timestampLabel}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </div>

      <div className="agents-support-grid">
        <SurfaceCard
          className={collapsedSections.models ? "is-collapsed" : ""}
          title="Models"
          subtitle={collapsedSections.models ? undefined : "Asignaciones activas."}
          aside={
            <button className={`mission-section-toggle${collapsedSections.models ? " is-collapsed" : ""}`} onClick={() => toggleSection("models")} type="button">
              <ChevronDown size={14} />
            </button>
          }
        >
          {!collapsedSections.models ? (
            <div className="agent-compact-grid">
              {data.modelSummary.map((model) => (
                <div key={model.id} className="agent-compact-row">
                  <div>
                    <strong>{model.label}</strong>
                    <p>{model.assignedAgents.join(" · ") || "No agents assigned yet"}</p>
                  </div>
                  <span className={`run-status-pill run-status-pill-${model.status}`}>{model.status.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </SurfaceCard>

        <SurfaceCard
          className={collapsedSections.connectors ? "is-collapsed" : ""}
          title="Connectors"
          subtitle={collapsedSections.connectors ? undefined : "Estado de disponibilidad."}
          aside={
            <button className={`mission-section-toggle${collapsedSections.connectors ? " is-collapsed" : ""}`} onClick={() => toggleSection("connectors")} type="button">
              <ChevronDown size={14} />
            </button>
          }
        >
          {!collapsedSections.connectors ? (
            <div className="agent-compact-grid">
              {data.connectorSummary.map((connector) => (
                <div key={connector.id} className="agent-compact-row">
                  <div>
                    <strong>{connector.label}</strong>
                    <p>{connector.capability}</p>
                  </div>
                  <span className={`run-status-pill run-status-pill-${connector.status}`}>{connector.status.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </div>

      <AgentWizardPanel initialAgent={selectedAgent} mode="edit" onClose={() => setEditorOpen(false)} open={editorOpen} />
    </div>
  );
};
