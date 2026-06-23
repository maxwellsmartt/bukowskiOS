import { useMemo, useState } from "react";
import { CopyPlus, PauseCircle, PlayCircle, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentRosterRow } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { titleCaseEnum } from "@shared/labels/statusLabels";
import { getAgentProviderBrand } from "@shared/lib/agentProviderBranding";

import { AgentDomainInsightPanel } from "./AgentDomainInsightPanel";
import { AgentWizardPanel } from "./AgentWizardPanel";
import { setAgentStatus, useAgentDetail, useAgentsList, useMissionControlSnapshot } from "./useAgentsData";

const getAgentIndicatorTone = (status: AgentRosterRow["status"], operationalState: AgentRosterRow["operationalState"]) => {
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
  status: AgentRosterRow["status"],
  operationalState: AgentRosterRow["operationalState"],
  t: ReturnType<typeof useTranslation>["t"],
) => {
  if (status !== "active") {
    return t("agents.shared.agentStatus.paused");
  }

  return t(`agents.shared.operationalState.${operationalState}`);
};

export const AgentsPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const { data, error } = useAgentsList({ workspaceId });
  const { data: missionControl } = useMissionControlSnapshot({ workspaceId });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentRosterRow | null>(null);
  const [duplicateAgent, setDuplicateAgent] = useState<AgentRosterRow | null>(null);
  const { data: detail } = useAgentDetail(selectedAgentId, { workspaceId });

  const duplicateSeed = useMemo(() => {
    if (!duplicateAgent) {
      return null;
    }

      return {
        ...duplicateAgent,
        id: "",
        agentId: `${duplicateAgent.agentId}-copy`,
      displayName: t("agents.team.copyName", { name: duplicateAgent.displayName }),
    };
  }, [duplicateAgent, t]);

  return (
    <div className="page-stack">
      <SectionHeader
        title={t("agents.team.title")}
        body={t("agents.team.body")}
        titleTone="accent"
      />

      <div className={`agents-directory-layout${selectedAgentId ? "" : " is-directory-expanded"}`}>
        <SurfaceCard
          title={t("agents.team.cardTitle")}
          aside={
            <button className="primary-control" onClick={() => setCreateOpen(true)} type="button">
              <Plus size={14} />
              <span>{t("agents.team.createAgent")}</span>
            </button>
          }
        >
          {error ? <div className="empty-state">{t("agents.team.unavailable", { message: error })}</div> : null}

          <div className="agents-directory-grid">
            {data.map((agent) => (
              (() => {
                const providerBrand = getAgentProviderBrand(agent.modelLabel);

                return (
                  <button
                    key={agent.id}
                    className={`agent-directory-card${selectedAgentId === agent.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                    type="button"
                  >
                    <span
                      aria-label={getAgentIndicatorLabel(agent.status, agent.operationalState, t)}
                      className={`agent-live-dot agent-live-dot-${getAgentIndicatorTone(agent.status, agent.operationalState)}`}
                      data-tooltip={getAgentIndicatorLabel(agent.status, agent.operationalState, t)}
                    />
                    <div className="agent-directory-card-header">
                      <div className="agent-directory-card-title">
                        <span className="mission-node-emoji">{agent.emoji}</span>
                        <strong>{agent.displayName}</strong>
                      </div>
                    </div>
                    <p>{agent.role}</p>
                    <div className="agent-directory-meta">
                      <span className={`mission-operational-pill mission-operational-pill-${agent.operationalState}`}>
                        {t(`agents.shared.operationalState.${agent.operationalState}`)}
                      </span>
                      <span className="subtle-pill agent-directory-model-pill" title={agent.modelLabel}>
                        {providerBrand.logoSrc ? (
                          <img
                            alt={providerBrand.logoAlt ?? providerBrand.label ?? t("agents.shared.aiService")}
                            className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                            src={providerBrand.logoSrc}
                          />
                        ) : null}
                        <span>{agent.modelLabel}</span>
                      </span>
                    </div>
                    <div className="agent-directory-actions">
                      <button
                        className="ghost-control"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditAgent(agent);
                        }}
                        type="button"
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        aria-label={
                          agent.status === "active"
                            ? t("agents.team.pauseAgentNamed", { name: agent.displayName })
                            : t("agents.team.reactivateAgentNamed", { name: agent.displayName })
                        }
                        className="ghost-control"
                        data-tooltip={agent.status === "active" ? t("agents.team.pauseAgent") : t("agents.team.reactivateAgent")}
                        onClick={async (event) => {
                          event.stopPropagation();
                          await setAgentStatus({
                            commandId: `cmd-agent-status-${Date.now().toString(36)}`,
                            workspaceId,
                            id: agent.id,
                            status: agent.status === "active" ? "paused" : "active",
                          });
                        }}
                        type="button"
                      >
                        {agent.status === "active" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                      </button>
                      <button
                        aria-label={t("agents.team.duplicateAgentNamed", { name: agent.displayName })}
                        className="ghost-control"
                        data-tooltip={t("agents.team.duplicateAgent")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDuplicateAgent(agent);
                        }}
                        type="button"
                      >
                        <CopyPlus size={14} />
                      </button>
                    </div>
                  </button>
                );
              })()
            ))}
          </div>
        </SurfaceCard>

        {selectedAgentId ? (
          <SurfaceCard
            className="agents-detail-card agents-detail-card-glass"
            title={detail.agent?.displayName ?? t("agents.team.loadingAgent")}
            aside={
              <div className="surface-card-actions">
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
            {detail.agent ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`mission-operational-pill mission-operational-pill-${detail.agent.operationalState}`}>
                  {t(`agents.shared.operationalState.${detail.agent.operationalState}`)}
                </span>
                <span className={`mission-node-status mission-node-status-${detail.agent.status}`}>
                  {t(`agents.shared.agentStatus.${detail.agent.status}`, { defaultValue: titleCaseEnum(detail.agent.status) })}
                </span>
                <span className="subtle-pill">
                  {(() => {
                    const providerBrand = getAgentProviderBrand(detail.agent.modelLabel);
                    return providerBrand.logoSrc ? (
                      <img
                        alt={providerBrand.logoAlt ?? providerBrand.label ?? t("agents.shared.aiService")}
                        className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                        src={providerBrand.logoSrc}
                      />
                    ) : null;
                  })()}
                  <span>{detail.agent.modelLabel}</span>
                </span>
                <span className="subtle-pill">{t(`agents.shared.approvalMode.${detail.agent.approvalMode}`, { defaultValue: titleCaseEnum(detail.agent.approvalMode) })}</span>
              </div>
              <div className="agent-detail-meta">
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.tools")}</span>
                  {detail.tools.length ? (
                    <div className="agent-tool-chips">
                      {detail.tools.map((tool) => (
                        <span className="agent-tool-chip" key={tool}>
                          {tool}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <strong>{t("agents.team.noToolsDefined")}</strong>
                  )}
                  {(() => {
                    const writeTools = detail.tools.filter((tool) =>
                      /^(create_|update_|return_|assign_|release_|delegate_)/.test(tool),
                    );
                    if (!writeTools.length) {
                      return (
                        <span className="agent-tools-badge agent-tools-badge-read">
                          {t("agents.team.readOnlyTools", { count: detail.tools.length })}
                        </span>
                      );
                    }
                    return (
                      <span className="agent-tools-badge agent-tools-badge-write">
                        {t("agents.team.writeTools", { count: writeTools.length })}
                      </span>
                    );
                  })()}
                </div>
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.domains")}</span>
                  <strong>{detail.domains.join(" · ") || t("agents.team.noDomainsDefined")}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">{t("agents.team.mission")}</span>
                  <strong>{detail.agent.mission}</strong>
                </div>
              </div>
              <p className="agent-detail-notes">{detail.agent.notes || t("agents.team.noNotes")}</p>

              <AgentDomainInsightPanel domain={detail.agent.domain} missionControl={missionControl} />

              <div className="agent-detail-runs">
                <span className="agent-detail-kicker">{t("agents.runs.recentActivity")}</span>
                {detail.recentRuns.length ? (
                  detail.recentRuns.map((run) => (
                    <div key={run.id} className="agent-run-row">
                      <div>
                        <strong>{run.title}</strong>
                        <p>{run.summary}</p>
                      </div>
                      <div className="agent-run-row-meta">
                        <span className={`run-status-pill run-status-pill-${run.status}`}>
                          {t(`agents.runs.status.${run.status}`, { defaultValue: titleCaseEnum(run.status) })}
                        </span>
                        <span className="agent-run-time">{run.updatedAtLabel}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">{t("agents.team.noRecentActivity")}</div>
                )}
              </div>
            </div>
            ) : (
              <div className="empty-state">{t("agents.team.loadingDetails")}</div>
            )}
          </SurfaceCard>
        ) : null}
      </div>

      <AgentWizardPanel onClose={() => setCreateOpen(false)} open={createOpen} />
      <AgentWizardPanel initialAgent={editAgent} mode="edit" onClose={() => setEditAgent(null)} open={Boolean(editAgent)} />
      <AgentWizardPanel initialAgent={duplicateSeed} onClose={() => setDuplicateAgent(null)} open={Boolean(duplicateSeed)} />
    </div>
  );
};
