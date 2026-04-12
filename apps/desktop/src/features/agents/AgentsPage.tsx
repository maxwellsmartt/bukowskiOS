import { useMemo, useState } from "react";
import { CopyPlus, PauseCircle, PlayCircle, Plus } from "lucide-react";

import type { AgentRosterRow } from "@contracts";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { AgentDomainInsightPanel } from "./AgentDomainInsightPanel";
import { AgentWizardPanel } from "./AgentWizardPanel";
import { setAgentStatus, useAgentDetail, useAgentsList, useMissionControlSnapshot } from "./useAgentsData";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

export const AgentsPage = () => {
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
      <SectionHeader
        title="Agents"
        titleTone="accent"
        body="Browse the roster, adjust supervision posture and shape each specialist through a visual builder."
      />

      <div className="agents-directory-layout">
        <SurfaceCard
          title="Agent directory"
          subtitle="The current roster, models and operating posture."
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
              <button
                key={agent.id}
                className={`agent-directory-card${selectedAgentId === agent.id ? " is-selected" : ""}`}
                onClick={() => setSelectedAgentId(agent.id)}
                type="button"
              >
                <div className="agent-directory-card-header">
                  <span className="mission-node-emoji">{agent.emoji}</span>
                  <span className={`mission-node-status mission-node-status-${agent.status}`}>{agent.status}</span>
                </div>
                <strong>{agent.displayName}</strong>
                <p>{agent.role}</p>
                <div className="agent-directory-meta">
                  <span className="subtle-pill">{agent.domain}</span>
                  <span className="subtle-pill">{agent.modelLabel}</span>
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
                    Configure
                  </button>
                  <button
                    className="ghost-control"
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
                    className="ghost-control"
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
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard
          title={detail.agent?.displayName ?? "Select an agent"}
          subtitle={detail.agent?.role ?? "The selected agent opens here with scope, posture and recent activity."}
        >
          {detail.agent ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`mission-node-status mission-node-status-${detail.agent.status}`}>{detail.agent.status}</span>
                <span className="subtle-pill">{detail.agent.modelLabel}</span>
                <span className="subtle-pill">{detail.agent.approvalMode.replace(/_/g, " ")}</span>
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
              </div>
              <p className="agent-detail-notes">{detail.agent.notes || "No notes for this agent yet."}</p>

              <AgentDomainInsightPanel domain={detail.agent.domain} missionControl={missionControl} />

              <div className="agent-detail-runs">
                <span className="agent-detail-kicker">Recent runs</span>
                {detail.recentRuns.length ? (
                  detail.recentRuns.map((run) => (
                    <div key={run.id} className="agent-run-row">
                      <div>
                        <strong>{run.title}</strong>
                        <p>{run.summary}</p>
                      </div>
                      <div className="agent-run-row-meta">
                        <span className={`run-status-pill run-status-pill-${run.status}`}>{run.status.replace(/_/g, " ")}</span>
                        <span className="agent-run-time">{run.updatedAtLabel}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No recent runs for this agent yet.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Select any agent card to inspect its configured scope and recent runs.</div>
          )}
        </SurfaceCard>
      </div>

      <AgentWizardPanel onClose={() => setCreateOpen(false)} open={createOpen} />
      <AgentWizardPanel initialAgent={editAgent} mode="edit" onClose={() => setEditAgent(null)} open={Boolean(editAgent)} />
      <AgentWizardPanel initialAgent={duplicateSeed} onClose={() => setDuplicateAgent(null)} open={Boolean(duplicateSeed)} />
    </div>
  );
};
