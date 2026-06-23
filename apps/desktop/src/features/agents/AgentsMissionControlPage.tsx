import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellDot, Bot, CircleAlert, History, PauseCircle, PlayCircle, PlugZap, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { CompactSelect } from "@shared/components/CompactSelect";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { getAgentRunStatusLabel, titleCaseEnum } from "@shared/labels/statusLabels";
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
type MissionConnectorLifecycle = "live" | "staged" | "planned";
type MissionQueueFilter = "all" | "needs_approval" | "running" | "done";
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

const getMissionConnectorLifecycle = (connectorKey: string): MissionConnectorLifecycle => {
  if (connectorKey === "telegram") {
    return "live";
  }

  if (connectorKey === "whatsapp" || connectorKey === "email") {
    return "staged";
  }

  return "planned";
};

const getMissionConnectorStatusLabel = (
  status: "configured" | "disabled" | "not_configured",
  lifecycle: MissionConnectorLifecycle,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  if (status === "configured" && lifecycle === "live") {
    return t("agents.connectors.status.live", { defaultValue: "Live" });
  }

  if (status === "configured") {
    return t("agents.connectors.status.staged", { defaultValue: "Preparado" });
  }

  if (status === "disabled") {
    return t("agents.connectors.status.paused", { defaultValue: "Pausado" });
  }

  return lifecycle === "planned"
    ? t("agents.connectors.status.planned", { defaultValue: "Planificado" })
    : t("agents.connectors.status.blocked", { defaultValue: "Bloqueado" });
};

const getMissionConnectorHint = (
  status: "configured" | "disabled" | "not_configured",
  lifecycle: MissionConnectorLifecycle,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  if (status === "configured" && lifecycle === "live") {
    return t("agents.connectors.hints.liveReady", { defaultValue: "Live y respondiendo desde este workspace" });
  }

  if (status === "configured") {
    return t("agents.connectors.hints.stagedReady", { defaultValue: "Preparado y pendiente de la conexión final" });
  }

  if (status === "disabled") {
    return t("agents.connectors.hints.paused", { defaultValue: "Configurado pero en pausa" });
  }

  return lifecycle === "planned"
    ? t("agents.connectors.hints.plannedBlocked", { defaultValue: "Bloqueado hasta que este canal se habilite" })
    : t("agents.connectors.hints.blocked", { defaultValue: "Bloqueado hasta conectar credenciales y entrega real" });
};

export const AgentsMissionControlPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const { data, error, reload } = useMissionControlSnapshot({ workspaceId });
  const [searchParams] = useSearchParams();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<MissionQueueFilter>("all");
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);
  const [activeMissionPanel, setActiveMissionPanel] = useState<MissionSectionKey | null>(null);
  const missionPanelRef = useRef<HTMLDivElement | null>(null);
  const missionPanelPopupRef = useRef<HTMLDivElement | null>(null);
  const [missionPanelStyle, setMissionPanelStyle] = useState<{ top: number; left: number } | null>(null);
  const { data: detail, reload: reloadDetail } = useAgentDetail(selectedAgentId, { workspaceId });

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
  const rosterAgents = useMemo(
    () => (data.supervisor ? [data.supervisor, ...data.subagents] : data.subagents),
    [data.subagents, data.supervisor],
  );
  const pausedAgentCount = useMemo(
    () => rosterAgents.filter((agent) => agent.status === "paused").length,
    [rosterAgents],
  );
  const workingAgentCount = useMemo(
    () => rosterAgents.filter((agent) => agent.operationalState === "working").length,
    [rosterAgents],
  );
  const connectorLifecycleSummary = useMemo(() => {
    let live = 0;
    let staged = 0;
    let blocked = 0;

    for (const connector of orderedConnectorSummary) {
      const lifecycle = getMissionConnectorLifecycle(connector.connectorKey);

      if (connector.status === "configured" && lifecycle === "live") {
        live += 1;
        continue;
      }

      if (connector.status === "configured") {
        staged += 1;
        continue;
      }

      blocked += 1;
    }

    return { live, staged, blocked };
  }, [orderedConnectorSummary]);
  const providerReadinessSummary = useMemo(() => {
    let healthy = 0;
    let configured = 0;
    let attention = 0;

    for (const provider of orderedModelSummary) {
      if (provider.status === "healthy") {
        healthy += 1;
        continue;
      }

      if (provider.status === "configured" || provider.status === "testing") {
        configured += 1;
        continue;
      }

      attention += 1;
    }

    return { healthy, configured, attention };
  }, [orderedModelSummary]);
  const healthCards = useMemo(
    () => [
      {
        label: t("agents.mission.health.activeAgents"),
        value: data.health.activeAgents,
        helper:
          pausedAgentCount > 0
            ? t("agents.mission.health.activeAgentsWithPaused", {
                count: pausedAgentCount,
                defaultValue: `${rosterAgents.length} en roster · ${pausedAgentCount} en pausa`,
              })
            : t("agents.mission.health.activeAgentsHint", {
                defaultValue: `${rosterAgents.length} en roster · sin pausas visibles`,
              }),
        icon: Bot,
        tone: "positive",
      },
      {
        label: t("agents.mission.health.workingNow", { defaultValue: "Trabajando ahora" }),
        value: String(workingAgentCount),
        helper:
          workingAgentCount > 0
            ? t("agents.mission.health.workingNowHint", {
                count: workingAgentCount,
                defaultValue: `${workingAgentCount} agentes están ejecutando tareas ahora mismo`,
              })
            : t("agents.mission.health.workingNowClear", {
                defaultValue: "Roster estable; no vemos tareas corriendo en esta pasada",
              }),
        icon: PlayCircle,
        tone: workingAgentCount > 0 ? "positive" : "neutral",
      },
      {
        label: t("agents.mission.health.pendingReviews", { defaultValue: "Revisiones" }),
        value: String(pendingApprovals.length),
        helper:
          pendingApprovals.length > 0
            ? t("agents.mission.health.pendingReviewsHint", {
                count: pendingApprovals.length,
                defaultValue: `${pendingApprovals.length} espera tu visto bueno`,
              })
            : t("agents.mission.health.pendingReviewsClear", { defaultValue: "Nada detenido por aprobación" }),
        icon: ShieldCheck,
        tone: pendingApprovals.length > 0 ? "warning" : "neutral",
      },
      {
        label: t("agents.mission.health.activeChannels"),
        value: String(connectorLifecycleSummary.live),
        helper: t("agents.mission.health.activeChannelsSplit", {
          defaultValue: `${connectorLifecycleSummary.staged} preparados · ${connectorLifecycleSummary.blocked} bloqueados`,
        }),
        icon: PlugZap,
        tone: connectorLifecycleSummary.live > 0 ? "positive" : connectorLifecycleSummary.staged > 0 ? "warning" : "neutral",
      },
      {
        label: t("agents.mission.health.assignedModels"),
        value: String(providerReadinessSummary.healthy),
        helper: t("agents.mission.health.assignedModelsSplit", {
          defaultValue: `${providerReadinessSummary.configured} configurados · ${providerReadinessSummary.attention} requieren atención`,
        }),
        icon: Bot,
        tone:
          providerReadinessSummary.attention > 0
            ? "warning"
            : providerReadinessSummary.healthy > 0
              ? "positive"
              : "neutral",
      },
    ],
    [
      connectorLifecycleSummary.blocked,
      connectorLifecycleSummary.live,
      connectorLifecycleSummary.staged,
      data.health.activeAgents,
      pausedAgentCount,
      pendingApprovals.length,
      providerReadinessSummary.attention,
      providerReadinessSummary.configured,
      providerReadinessSummary.healthy,
      rosterAgents.length,
      t,
      workingAgentCount,
    ],
  );
  const missionPanelButtons = useMemo(
    () => [
      { key: "activity" as const, icon: History, label: t("agents.runs.recentActivity") },
      { key: "queue" as const, icon: BellDot, label: t("agents.mission.queueAndReviews", { defaultValue: "Cola operativa" }) },
      { key: "models" as const, icon: Bot, label: t("agents.models.title") },
      { key: "connectors" as const, icon: PlugZap, label: t("agents.connectors.title") },
    ],
    [t],
  );
  const queueFilterOptions = useMemo(
    () => [
      { value: "all" as const, label: t("agents.runs.filters.all") },
      { value: "needs_approval" as const, label: t("agents.runs.summary.needsApproval") },
      { value: "running" as const, label: t("agents.runs.summary.running") },
      { value: "done" as const, label: t("agents.runs.summary.done") },
    ],
    [t],
  );

  useEffect(() => {
    if (!activeMissionPanel) {
      setMissionPanelStyle(null);
      return;
    }

    const updateMissionPanelPosition = () => {
      const anchor = missionPanelRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const popupWidth = Math.min(400, window.innerWidth - 48);
      const popupHeight = Math.min(460, window.innerHeight - 80);
      const left = Math.max(16, Math.min(rect.right - popupWidth, window.innerWidth - popupWidth - 16));
      const preferredTop = rect.bottom + 10;
      const top =
        preferredTop + popupHeight <= window.innerHeight - 16
          ? preferredTop
          : Math.max(16, rect.top - popupHeight - 10);

      setMissionPanelStyle({ top, left });
    };

    updateMissionPanelPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (missionPanelRef.current?.contains(target) || missionPanelPopupRef.current?.contains(target)) {
        return;
      }

      setActiveMissionPanel(null);
    };

    const handleLayoutChange = () => updateMissionPanelPosition();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [activeMissionPanel]);

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

  const renderMissionPanelContent = () => {
    switch (activeMissionPanel) {
      case "queue":
        return (
          <div className="mission-panel-section">
            <div className="table-filter-select-row mission-panel-filter-select-row">
              <CompactSelect<MissionQueueFilter>
                ariaLabel={t("agents.runs.filters.all")}
                className="table-filter-select mission-panel-filter-select mission-panel-filter-select-compact"
                onChange={setQueueFilter}
                options={queueFilterOptions}
                popupMinWidth={188}
                value={queueFilter}
              />
            </div>
            <div className="agent-support-list agent-support-list-scroll mission-panel-scroll">
              {filteredQueue.length === 0 ? (
                <div className="empty-state compact-empty-state">
                  {t("agents.runs.empty", { defaultValue: "No hay filas pendientes en esta vista." })}
                </div>
              ) : null}
              {filteredQueue.map((run) => (
                <button
                  key={run.id}
                  className="agent-run-row agent-run-row-button"
                  onClick={() => {
                    setSelectedAgentId(run.agentId ?? data.supervisor?.id ?? null);
                    setActiveMissionPanel(null);
                  }}
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
        );
      case "activity":
        return (
          <div className="agent-support-list agent-support-list-scroll mission-panel-scroll">
            {data.activity.length === 0 ? (
              <div className="empty-state compact-empty-state">
                {t("agents.mission.noRecentActivity", { defaultValue: "No hay actividad reciente visible ahora mismo." })}
              </div>
            ) : null}
            {data.activity.map((activity) => (
              <button
                key={activity.id}
                className="agent-activity-row agent-activity-row-button"
                onClick={() => {
                  setSelectedAgentId(activity.agentId ?? data.supervisor?.id ?? null);
                  setActiveMissionPanel(null);
                }}
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
        );
      case "models":
        return (
          <div className="agent-compact-grid mission-panel-scroll">
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
                  <p>
                    {model.assignedAgents.length
                      ? t("agents.models.assignedAgentCount", { count: model.assignedAgents.length })
                      : t("agents.models.noAgentsAssigned")}
                  </p>
                  {model.assignedAgents.length ? (
                    <span className="mission-panel-helper-copy">{model.assignedAgents.join(" · ")}</span>
                  ) : null}
                </div>
                <span className={`run-status-pill run-status-pill-${model.status}`}>
                  {t(`agents.models.status.${model.status}`, { defaultValue: titleCaseEnum(model.status) })}
                </span>
              </div>
            ))}
          </div>
        );
      case "connectors":
        return (
          <div className="agent-compact-grid mission-panel-scroll">
            {orderedConnectorSummary.map((connector) => (
              (() => {
                const lifecycle = getMissionConnectorLifecycle(connector.connectorKey);

                return (
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
                      <span className="mission-panel-helper-copy">
                        {getMissionConnectorHint(connector.status, lifecycle, t)}
                      </span>
                    </div>
                    <div className="mission-panel-pill-stack">
                      <span className="subtle-pill">{t(`agents.connectors.lifecycle.${lifecycle}.label`)}</span>
                      <span className={`run-status-pill run-status-pill-${connector.status}`}>
                        {getMissionConnectorStatusLabel(connector.status, lifecycle, t)}
                      </span>
                    </div>
                  </div>
                );
              })()
            ))}
          </div>
        );
      default:
        return null;
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
        {healthCards.map((card) => {
          const Icon = card.icon;

          return (
            <SurfaceCard key={card.label} className={`agents-health-card agents-health-card-${card.tone}`}>
              <div className="agents-health-card-topline">
                <span className={`agents-health-icon agents-health-icon-${card.tone}`}>
                  <Icon size={14} />
                </span>
                <span className="agents-health-label">{card.label}</span>
              </div>
              <strong className="agents-health-value">{card.value}</strong>
              <span className="agents-health-helper">{card.helper}</span>
            </SurfaceCard>
          );
        })}
      </div>

      <div className={`agents-mission-layout${selectedAgent ? "" : " is-graph-expanded"}`}>
        <SurfaceCard
          className="agents-graph-card mission-team-map-card"
          title={t("agents.mission.teamMap")}
          aside={
            <div className="mission-panel-anchor" ref={missionPanelRef}>
              <div className="mission-panel-toolbar">
                {missionPanelButtons.map((button) => {
                  const Icon = button.icon;
                  const isActive = activeMissionPanel === button.key;

                  return (
                    <button
                      key={button.key}
                      aria-expanded={isActive}
                      aria-label={button.label}
                      className={`mission-panel-trigger${isActive ? " is-active" : ""}`}
                      data-tooltip={button.label}
                      onClick={() => setActiveMissionPanel((current) => (current === button.key ? null : button.key))}
                      type="button"
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>

            </div>
          }
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
                    <div className="mission-node-copy">
                      <span className="mission-node-role mission-node-role-clamped">{data.supervisor.role}</span>
                    </div>
                    <div className="mission-node-footer mission-node-footer-single-row">
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
                      <span className={`mission-operational-pill mission-operational-pill-${data.supervisor.operationalState}`}>
                        {t(`agents.shared.operationalState.${data.supervisor.operationalState}`)}
                      </span>
                      <span className={`mission-node-status mission-node-status-${data.supervisor.status}`}>
                        {t(`agents.shared.agentStatus.${data.supervisor.status}`)}
                      </span>
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
                        <div className="mission-node-copy">
                          <span className="mission-node-role mission-node-role-clamped">{agent.role}</span>
                        </div>
                        <div className="mission-node-footer mission-node-footer-single-row">
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
                          <span className={`mission-operational-pill mission-operational-pill-${agent.operationalState}`}>
                            {t(`agents.shared.operationalState.${agent.operationalState}`)}
                          </span>
                          <span className={`mission-node-status mission-node-status-${agent.status}`}>
                            {t(`agents.shared.agentStatus.${agent.status}`)}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })()
              ))}
            </div>
          </div>
        </SurfaceCard>

        {activeMissionPanel && missionPanelStyle && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={missionPanelPopupRef}
                className="mission-panel-popover"
                role="dialog"
                aria-label={missionPanelButtons.find((item) => item.key === activeMissionPanel)?.label}
                style={{ top: missionPanelStyle.top, left: missionPanelStyle.left }}
              >
                <div className="mission-panel-popover-header">
                  <strong>{missionPanelButtons.find((item) => item.key === activeMissionPanel)?.label}</strong>
                  <button
                    aria-label={t("common.close", { defaultValue: "Cerrar" })}
                    className="icon-ghost-control"
                    onClick={() => setActiveMissionPanel(null)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mission-panel-popover-body">{renderMissionPanelContent()}</div>
              </div>,
              document.body,
            )
          : null}

        {selectedAgent ? (
          <SurfaceCard
            className="agents-detail-card agents-detail-card-glass"
            title={selectedAgent.displayName}
            subtitle={selectedAgent.role}
            aside={
              <div className="surface-card-actions">
                <button className="ghost-control mission-control-configure" onClick={() => setEditorOpen(true)} type="button">
                  {t("common.edit")}
                </button>
                <button
                  aria-label={t("agents.team.closeDetail")}
                  className="icon-ghost-control"
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
                  {t(`agents.shared.operationalState.${selectedAgent.operationalState}`, { defaultValue: titleCaseEnum(selectedAgent.operationalState) })}
                </span>
                <span className={`mission-node-status mission-node-status-${selectedAgent.status}`}>
                  {t(`agents.shared.agentStatus.${selectedAgent.status}`, { defaultValue: titleCaseEnum(selectedAgent.status) })}
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
                <span className="subtle-pill">{t(`agents.shared.approvalMode.${selectedAgent.approvalMode}`, { defaultValue: titleCaseEnum(selectedAgent.approvalMode) })}</span>
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
                  {detail.tools.length ? (
                    <div className="agent-tool-chips">
                      {detail.tools.map((tool) => (
                        <span className="agent-tool-chip" key={tool}>
                          {tool}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <strong>{t("agents.team.noToolsAssigned")}</strong>
                  )}
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

      <AgentWizardPanel initialAgent={selectedAgent} mode="edit" onClose={() => setEditorOpen(false)} open={editorOpen} />
    </div>
  );
};
