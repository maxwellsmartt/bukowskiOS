import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, ChevronDown, CircleAlert, PauseCircle, PlayCircle, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { getAgentApprovalModeLabel, getAgentRunStatusLabel, titleCaseEnum } from "@shared/labels/statusLabels";
import { getAgentProviderBrand } from "@shared/lib/agentProviderBranding";
import { getConnectorBrand } from "@shared/lib/connectorBranding";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { AgentWizardPanel } from "./AgentWizardPanel";
import { reviewAgentRun, setAgentApprovalMode, setAgentStatus, useAgentDetail, useMissionControlSnapshot } from "./useAgentsData";

const getAgentIndicatorTone = (
  status: "active" | "paused",
  operationalState: "idle" | "working" | "not_working",
) => {
  if (status !== "active") {
    return "amber";
  }

  if (operationalState === "working") {
    return "green";
  }

  if (operationalState === "not_working") {
    return "red";
  }

  return "amber";
};

const getAgentIndicatorLabel = (
  status: "active" | "paused",
  operationalState: "idle" | "working" | "not_working",
  t: ReturnType<typeof useTranslation>["t"],
) => {
  if (status !== "active") {
    return t("agents.shared.agentStatus.paused");
  }

  return t(`agents.shared.operationalState.${operationalState}`);
};

type MissionSectionKey = "queue" | "activity" | "models" | "connectors";
const providerDisplayOrder = ["openai", "anthropic", "openclaw", "custom"] as const;
const connectorDisplayOrder = ["telegram", "whatsapp", "email", "webhook"] as const;

const sortByDisplayOrder = <T extends { label: string }>(items: T[], key: (item: T) => string, displayOrder: readonly string[]) =>
  [...items].sort((left, right) => {
    const leftOrder = displayOrder.indexOf(key(left));
    const rightOrder = displayOrder.indexOf(key(right));

    if (leftOrder !== -1 || rightOrder !== -1) {
      if (leftOrder === -1) return 1;
      if (rightOrder === -1) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    return left.label.localeCompare(right.label);
  });

const CollapsibleMissionCard = ({
  children,
  className = "",
  collapsed,
  onToggle,
  title,
}: {
  children: ReactNode;
  className?: string;
  collapsed: boolean;
  onToggle: () => void;
  title: string;
}) => (
  <SurfaceCard className={`${className}${collapsed ? " is-collapsed" : ""}`.trim()}>
    <button
      aria-expanded={!collapsed}
      className="mission-card-header-button"
      onClick={onToggle}
      type="button"
    >
      <span className="surface-card-title">{title}</span>
      <ChevronDown className={`mission-section-toggle${collapsed ? " is-collapsed" : ""}`} size={14} />
    </button>
    {!collapsed ? children : null}
  </SurfaceCard>
);

export const AgentsMissionControlPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const { data, error, reload } = useMissionControlSnapshot();
  const [searchParams] = useSearchParams();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "needs_approval" | "running" | "done">("all");
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState({
    queue: true,
    activity: true,
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
      { label: t("agents.mission.health.activeAgents"), value: data.health.activeAgents },
      { label: t("agents.mission.health.pausedAgents"), value: data.health.pausedAgents },
      { label: t("agents.mission.health.recentActivity"), value: data.health.recentRuns },
      { label: t("agents.mission.health.activeChannels"), value: data.health.connectorsConfigured },
      { label: t("agents.mission.health.assignedModels"), value: data.health.modelsAssigned },
    ],
    [data.health, t],
  );

  const filteredQueue = useMemo(() => {
    if (queueFilter === "all") {
      return data.queue;
    }

    return data.queue.filter((run) => run.status === queueFilter);
  }, [data.queue, queueFilter]);
  const pendingApprovals = useMemo(() => data.queue.filter((run) => run.status === "needs_approval"), [data.queue]);
  const orderedModelSummary = useMemo(
    () => sortByDisplayOrder(data.modelSummary, (model) => model.providerKey, providerDisplayOrder),
    [data.modelSummary],
  );
  const orderedConnectorSummary = useMemo(
    () => sortByDisplayOrder(data.connectorSummary, (connector) => connector.connectorKey, connectorDisplayOrder),
    [data.connectorSummary],
  );

  const toggleSection = (section: MissionSectionKey) => {
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
      setApprovalFeedback(getUserFacingErrorMessage(error, t("agents.runs.errors.reviewDecision")));
    } finally {
      setProcessingRunId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title={t("agents.mission.title")}
        titleTone="accent"
      />

      {error ? <div className="empty-state">{t("agents.mission.unavailable", { message: error })}</div> : null}
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
          title={t("agents.mission.teamMap")}
        >
          <div className="mission-graph">
            {data.supervisor ? (
              (() => {
                const providerBrand = getAgentProviderBrand(data.supervisor.modelLabel);

                return (
                  <button
                    className={`mission-node mission-node-root mission-node-operational-${data.supervisor.operationalState}${
                      selectedAgentId === data.supervisor.id ? " is-selected" : ""
                    }`}
                    onClick={() => setSelectedAgentId(data.supervisor?.id ?? null)}
                    type="button"
                  >
                    <span
                      aria-label={getAgentIndicatorLabel(data.supervisor.status, data.supervisor.operationalState, t)}
                      className={`agent-live-dot agent-live-dot-${getAgentIndicatorTone(
                        data.supervisor.status,
                        data.supervisor.operationalState,
                      )}`}
                      data-tooltip={getAgentIndicatorLabel(data.supervisor.status, data.supervisor.operationalState, t)}
                    />
                    <div className="mission-node-topline">
                      <span className="mission-node-emoji">{data.supervisor.emoji}</span>
                      <span className="mission-node-name" title={data.supervisor.displayName}>
                        {data.supervisor.displayName}
                      </span>
                    </div>
                    <span className="mission-node-role mission-node-role-clamped">{data.supervisor.role}</span>
                    <div className="mission-node-footer">
                      <span className="subtle-pill mission-node-model-pill" title={data.supervisor.modelLabel}>
                        {providerBrand.logoSrc ? (
                          <img
                            alt={providerBrand.logoAlt ?? providerBrand.label ?? t("agents.shared.aiService")}
                            className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                            src={providerBrand.logoSrc}
                          />
                        ) : null}
                        <span>{data.supervisor.modelLabel}</span>
                      </span>
                      <div className="mission-node-footer-status-row">
                        <span className={`mission-operational-pill mission-operational-pill-${data.supervisor.operationalState}`}>
                          {t(`agents.shared.operationalState.`)}
                        </span>
                        <span className={`mission-node-status mission-node-status-${data.supervisor.status}`}>
                          {t(`agents.shared.agentStatus.`)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })()
            ) : null}

            <div className="mission-graph-spine" />

            <div className="mission-graph-band">
              {data.subagents.map((agent) => (
                (() => {
                  const providerBrand = getAgentProviderBrand(agent.modelLabel);

                  return (
                    <div key={agent.id} className="mission-graph-branch">
                      <div className="mission-graph-branch-line" />
                      <button
                        className={`mission-node mission-node-operational-${agent.operationalState}${
                          selectedAgentId === agent.id ? " is-selected" : ""
                        }`}
                        onClick={() => setSelectedAgentId(agent.id)}
                        type="button"
                      >
                        <span
                          aria-label={getAgentIndicatorLabel(agent.status, agent.operationalState, t)}
                          className={`agent-live-dot agent-live-dot-${getAgentIndicatorTone(
                            agent.status,
                            agent.operationalState,
                          )}`}
                          data-tooltip={getAgentIndicatorLabel(agent.status, agent.operationalState, t)}
                        />
                        <div className="mission-node-topline">
                          <span className="mission-node-emoji">{agent.emoji}</span>
                          <span className="mission-node-name" title={agent.displayName}>
                            {agent.displayName}
                          </span>
                        </div>
                        <span className="mission-node-role mission-node-role-clamped">{agent.role}</span>
                        <div className="mission-node-footer">
                          <span className="subtle-pill mission-node-model-pill" title={agent.modelLabel}>
                            {providerBrand.logoSrc ? (
                              <img
                                alt={providerBrand.logoAlt ?? providerBrand.label ?? t("agents.shared.aiService")}
                                className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                                src={providerBrand.logoSrc}
                              />
                            ) : null}
                            <span>{agent.modelLabel}</span>
                          </span>
                          <div className="mission-node-footer-status-row">
                            <span className={`mission-operational-pill mission-operational-pill-${agent.operationalState}`}>
                              {t(`agents.shared.operationalState.`)}
                            </span>
                            <span className={`mission-node-status mission-node-status-${agent.status}`}>
                              {t(`agents.shared.agentStatus.`)}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })()
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
                  {t("common.edit")}
                </button>
                <button
                  aria-label={t("agents.team.closeDetail")}
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
              <div className="agent-detail-row agent-activity-filter-row">
                <span className={`mission-operational-pill mission-operational-pill-${selectedAgent.operationalState}`}>
                  {t(`agents.shared.operationalState.`)}
                </span>
                <span className={`mission-node-status mission-node-status-${selectedAgent.status}`}>
                  {t(`agents.shared.agentStatus.`)}
                </span>
                <span className="subtle-pill">
                  {(() => {
                    const providerBrand = getAgentProviderBrand(selectedAgent.modelLabel);
                    return providerBrand.logoSrc ? (
                      <img
                        alt={providerBrand.logoAlt ?? providerBrand.label ?? t("agents.shared.aiService")}
                        className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                        src={providerBrand.logoSrc}
                      />
                    ) : null;
                  })()}
                  <span>{selectedAgent.modelLabel}</span>
                </span>
                <span className="subtle-pill">{getAgentApprovalModeLabel(selectedAgent.approvalMode)}</span>
              </div>

              <div className="agent-detail-meta">
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.role")}</span>
                  <strong>{selectedAgent.role}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.mission")}</span>
                  <strong>{selectedAgent.mission}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.domain")}</span>
                  <strong>{selectedAgent.domain}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.allowedTools")}</span>
                  <strong>{detail.tools.join(" · ") || t("agents.team.noToolsAssigned")}</strong>
                </div>
              </div>

              <div className="agent-detail-actions">
                <button className="ghost-control" onClick={handleToggleStatus} type="button">
                  {selectedAgent.status === "active" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                  <span>{selectedAgent.status === "active" ? t("agents.team.pauseAgent") : t("agents.team.reactivateAgent")}</span>
                </button>
                <button className="ghost-control" onClick={handleApprovalModeCycle} type="button">
                  <ShieldCheck size={14} />
                  <span>{t("agents.mission.changeReviewMode")}</span>
                </button>
              </div>

              <div className="agent-detail-runs">
                <span className="agent-detail-kicker">{t("agents.runs.recentActivity")}</span>
                {detail.recentRuns.length ? (
                  detail.recentRuns.map((run) => (
                    <div key={run.id} className="agent-run-row">
                      <div>
                        <strong>{run.title}</strong>
                        <p>{run.summary}</p>
                      </div>
                      <span className={`run-status-pill run-status-pill-${run.status}`}>
                        {t(`agents.runs.status.${run.status}`, { defaultValue: getAgentRunStatusLabel(run.status) })}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">{t("agents.team.noRecentActivity")}</div>
                )}
              </div>
            </div>
          </SurfaceCard>
        ) : null}
      </div>

      {pendingApprovals.length ? (
        <SurfaceCard
          title={t("agents.mission.needsReview")}
        >
          <div className="agent-support-list">
            {pendingApprovals.map((run) => (
              <div key={run.id} className="agent-run-row agent-run-row-pending">
                <div className="agent-run-row-copy">
                  <div className="agent-run-row-heading">
                    <strong>{run.title}</strong>
                    <span className={`run-status-pill run-status-pill-${run.status}`}>
                      {t(`agents.runs.status.${run.status}`, { defaultValue: getAgentRunStatusLabel(run.status) })}
                    </span>
                  </div>
                  <p>{run.agentDisplayName}</p>
                  <p>{run.approvalReason ?? t("agents.mission.approvalFallback")}</p>
                  <div className="agent-run-approval-actions">
                    <button
                      className="primary-control"
                      disabled={processingRunId === run.id}
                      onClick={() => void handleReviewRun(run.id, "approve")}
                      type="button"
                    >
                      {t("agents.runs.approve")}
                    </button>
                    {run.threadId ? (
                      <button
                        className="surface-card-action-text"
                        disabled={processingRunId === run.id}
                        onClick={() => void handleReviewRun(run.id, "approve_for_session")}
                        type="button"
                      >
                        {t("agents.runs.approveForSession")}
                      </button>
                    ) : null}
                    <button
                      className="surface-card-action-text is-danger"
                      disabled={processingRunId === run.id}
                      onClick={() => void handleReviewRun(run.id, "deny")}
                      type="button"
                    >
                      {t("agents.runs.deny")}
                    </button>
                    <button
                      className="surface-card-action-text"
                      onClick={() => setSelectedAgentId(run.agentId ?? data.supervisor?.id ?? null)}
                      type="button"
                    >
                      {t("agents.mission.viewAgent")}
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

      <div className="agents-support-grid mission-overview-activity-grid">
        <CollapsibleMissionCard
          className="mission-activity-card"
          collapsed={collapsedSections.queue}
          onToggle={() => toggleSection("queue")}
          title={t("agents.runs.recentActivity")}
        >
            <div className="mission-collapsible-content">
              <div className="agent-detail-row">
                <button className={`chip-button${queueFilter === "all" ? " is-active" : ""}`} onClick={() => setQueueFilter("all")} type="button">
                  {t("agents.runs.filters.all")}
                </button>
                <button
                  className={`chip-button${queueFilter === "needs_approval" ? " is-active" : ""}`}
                  onClick={() => setQueueFilter("needs_approval")}
                  type="button"
                >
                  {t("agents.runs.summary.needsApproval")}
                </button>
                <button
                  className={`chip-button${queueFilter === "running" ? " is-active" : ""}`}
                  onClick={() => setQueueFilter("running")}
                  type="button"
                >
                  {t("agents.runs.summary.running")}
                </button>
                <button className={`chip-button${queueFilter === "done" ? " is-active" : ""}`} onClick={() => setQueueFilter("done")} type="button">
                  {t("agents.runs.summary.done")}
                </button>
              </div>
              <div className="agent-support-list agent-support-list-scroll">
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
                      <span className={`run-status-pill run-status-pill-${run.status}`}>
                        {t(`agents.runs.status.${run.status}`, { defaultValue: getAgentRunStatusLabel(run.status) })}
                      </span>
                      <span className="agent-run-time">{run.updatedAtLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
        </CollapsibleMissionCard>

        <CollapsibleMissionCard
          className="mission-activity-card"
          collapsed={collapsedSections.activity}
          onToggle={() => toggleSection("activity")}
          title={t("agents.mission.updates")}
        >
            <div className="agent-support-list agent-support-list-scroll mission-collapsible-content">
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
        </CollapsibleMissionCard>
      </div>

      <div className="agents-support-grid">
        <CollapsibleMissionCard
          collapsed={collapsedSections.models}
          onToggle={() => toggleSection("models")}
          title={t("agents.models.title")}
        >
            <div className="agent-compact-grid mission-collapsible-content">
              {orderedModelSummary.map((model) => (
                <div key={model.id} className="agent-compact-row">
                  <div>
                    <strong className="provider-heading">
                      {(() => {
                        const providerBrand = getAgentProviderBrand(model.providerKey);
                        return providerBrand.logoSrc ? (
                          <img
                            alt={providerBrand.logoAlt ?? model.label}
                            className={`provider-heading-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                            src={providerBrand.logoSrc}
                          />
                        ) : null;
                      })()}
                      <span>{model.label}</span>
                    </strong>
                    <p>{model.assignedAgents.join(" · ") || t("agents.models.noAgentsAssigned")}</p>
                  </div>
                  <span className={`run-status-pill run-status-pill-${model.status}`}>
                    {t(`agents.models.status.${model.status}`, { defaultValue: titleCaseEnum(model.status) })}
                  </span>
                </div>
              ))}
            </div>
        </CollapsibleMissionCard>

        <CollapsibleMissionCard
          collapsed={collapsedSections.connectors}
          onToggle={() => toggleSection("connectors")}
          title={t("agents.connectors.title")}
        >
            <div className="agent-compact-grid mission-collapsible-content">
              {orderedConnectorSummary.map((connector) => (
                <div key={connector.id} className="agent-compact-row">
                  <div>
                    <strong className="provider-heading">
                      {(() => {
                        const connectorBrand = getConnectorBrand(connector.connectorKey);
                        return connectorBrand.logoSrc ? (
                          <img
                            alt={connectorBrand.logoAlt ?? connector.label}
                            className={`provider-heading-logo${connectorBrand.logoClassName ? ` ${connectorBrand.logoClassName}` : ""}`}
                            src={connectorBrand.logoSrc}
                          />
                        ) : null;
                      })()}
                      <span>{connector.label}</span>
                    </strong>
                    <p>{connector.capability}</p>
                  </div>
                  <span className={`run-status-pill run-status-pill-${connector.status}`}>
                    {t(`agents.connectors.status.${connector.status}`, { defaultValue: titleCaseEnum(connector.status) })}
                  </span>
                </div>
              ))}
            </div>
        </CollapsibleMissionCard>
      </div>

      <AgentWizardPanel initialAgent={selectedAgent} mode="edit" onClose={() => setEditorOpen(false)} open={editorOpen} />
    </div>
  );
};
