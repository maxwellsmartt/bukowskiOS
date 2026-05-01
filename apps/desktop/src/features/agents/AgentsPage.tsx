import { useMemo, useState } from "react";
import { CopyPlus, PauseCircle, PlayCircle, Plus, X } from "lucide-react";

import type { AgentRosterRow } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getAgentApprovalModeLabel, titleCaseEnum } from "@shared/labels/statusLabels";
import { getAgentProviderBrand } from "@shared/lib/agentProviderBranding";

import { AgentDomainInsightPanel } from "./AgentDomainInsightPanel";
import { AgentWizardPanel } from "./AgentWizardPanel";
import { setAgentStatus, useAgentDetail, useAgentsList, useMissionControlSnapshot } from "./useAgentsData";

const operationalStateLabelMap = {
  idle: "Idle",
  working: "Working",
  not_working: "Not working",
} as const;

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

const getAgentIndicatorLabel = (status: AgentRosterRow["status"], operationalState: AgentRosterRow["operationalState"]) => {
  if (status !== "active") {
    return "Paused";
  }

  return operationalStateLabelMap[operationalState];
};

export const AgentsPage = () => {
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const { data, error } = useAgentsList();
  const { data: missionControl } = useMissionControlSnapshot();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentRosterRow | null>(null);
  const [duplicateAgent, setDuplicateAgent] = useState<AgentRosterRow | null>(null);
  const { data: detail } = useAgentDetail(selectedAgentId);

  const duplicateSeed = useMemo(() => {
    if (!duplicateAgent) {
      return null;
    }

    return {
      ...duplicateAgent,
      id: "",
      agentId: `${duplicateAgent.agentId}-copy`,
      displayName: `${duplicateAgent.displayName} Copy`,
    };
  }, [duplicateAgent]);

  return (
    <div className="page-stack">
      <SectionHeader title="Automation Team" titleTone="accent" />

      <div className={`agents-directory-layout${selectedAgentId ? "" : " is-directory-expanded"}`}>
        <SurfaceCard
          title="Agents"
          aside={
            <button className="primary-control" onClick={() => setCreateOpen(true)} type="button">
              <Plus size={14} />
              <span>Create agent</span>
            </button>
          }
        >
          {error ? <div className="empty-state">Agents unavailable: {error}</div> : null}

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
                      aria-label={getAgentIndicatorLabel(agent.status, agent.operationalState)}
                      className={`agent-live-dot agent-live-dot-${getAgentIndicatorTone(agent.status, agent.operationalState)}`}
                      data-tooltip={getAgentIndicatorLabel(agent.status, agent.operationalState)}
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
                        {operationalStateLabelMap[agent.operationalState]}
                      </span>
                      <span className="subtle-pill agent-directory-model-pill" title={agent.modelLabel}>
                        {providerBrand.logoSrc ? (
                          <img
                            alt={providerBrand.logoAlt ?? providerBrand.label ?? "AI service"}
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
                        Edit
                      </button>
                      <button
                        aria-label={agent.status === "active" ? `Pause ${agent.displayName}` : `Reactivate ${agent.displayName}`}
                        className="ghost-control"
                        data-tooltip={agent.status === "active" ? "Pause agent" : "Reactivate agent"}
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
                        aria-label={`Duplicate ${agent.displayName}`}
                        className="ghost-control"
                        data-tooltip="Duplicate agent"
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
            title={detail.agent?.displayName ?? "Loading agent"}
            aside={
              <div className="surface-card-actions">
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
            {detail.agent ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`mission-operational-pill mission-operational-pill-${detail.agent.operationalState}`}>
                  {operationalStateLabelMap[detail.agent.operationalState]}
                </span>
                <span className={`mission-node-status mission-node-status-${detail.agent.status}`}>{titleCaseEnum(detail.agent.status)}</span>
                <span className="subtle-pill">
                  {(() => {
                    const providerBrand = getAgentProviderBrand(detail.agent.modelLabel);
                    return providerBrand.logoSrc ? (
                      <img
                        alt={providerBrand.logoAlt ?? providerBrand.label ?? "AI service"}
                        className={`provider-pill-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                        src={providerBrand.logoSrc}
                      />
                    ) : null;
                  })()}
                  <span>{detail.agent.modelLabel}</span>
                </span>
                <span className="subtle-pill">{getAgentApprovalModeLabel(detail.agent.approvalMode)}</span>
              </div>
              <div className="agent-detail-meta">
                <div>
                  <span className="agent-detail-kicker">Tools</span>
                  <strong>{detail.tools.join(" · ") || "No tools defined"}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">Domains</span>
                  <strong>{detail.domains.join(" · ") || "No domains defined"}</strong>
                </div>
                <div>
                  <span className="agent-detail-kicker">Mission</span>
                  <strong>{detail.agent.mission}</strong>
                </div>
              </div>
              <p className="agent-detail-notes">{detail.agent.notes || "No notes for this agent yet."}</p>

              <AgentDomainInsightPanel domain={detail.agent.domain} missionControl={missionControl} />

              <div className="agent-detail-runs">
                <span className="agent-detail-kicker">Recent activity</span>
                {detail.recentRuns.length ? (
                  detail.recentRuns.map((run) => (
                    <div key={run.id} className="agent-run-row">
                      <div>
                        <strong>{run.title}</strong>
                        <p>{run.summary}</p>
                      </div>
                      <div className="agent-run-row-meta">
                        <span className={`run-status-pill run-status-pill-${run.status}`}>{titleCaseEnum(run.status)}</span>
                        <span className="agent-run-time">{run.updatedAtLabel}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No recent activity for this agent yet.</div>
                )}
              </div>
            </div>
            ) : (
              <div className="empty-state">Loading agent details...</div>
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
