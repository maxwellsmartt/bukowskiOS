import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";

import type { AgentApprovalMode, AgentRosterRow, AgentStatus } from "@contracts";

import { createAgent, updateAgent } from "./useAgentsData";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const inferDomain = (mission: string) => {
  const normalized = mission.toLowerCase();

  if (/(incident|maintenance|repair|rma|damage|loss)/.test(normalized)) {
    return "incidents";
  }

  if (/(finance|budget|cost|expense|reserve)/.test(normalized)) {
    return "finance";
  }

  if (/(schedule|timeline|project|unit|planning)/.test(normalized)) {
    return "projects";
  }

  if (/(email|message|notification|connector|support|whatsapp|telegram)/.test(normalized)) {
    return "communications";
  }

  return "assets";
};

const defaultToolsByDomain: Record<string, string[]> = {
  assets: ["assets.read", "packing.read", "compare.prepare"],
  incidents: ["incidents.read", "maintenance.watch", "rma.prepare"],
  finance: ["finance.read", "entries.review", "exposure.review"],
  projects: ["projects.read", "timeline.review", "units.review"],
  communications: ["connector.email", "connector.notifications", "draft.compose"],
};

const defaultDomainsByDomain: Record<string, string[]> = {
  assets: ["assets", "packing_slips", "catalog"],
  incidents: ["incidents", "maintenance", "rma"],
  finance: ["finance"],
  projects: ["projects", "schedule", "units"],
  communications: ["connectors", "notifications"],
};

const defaultModelByDomain: Record<string, string> = {
  assets: "openai:gpt-5.4-mini",
  incidents: "anthropic:sonnet-4",
  finance: "openai:gpt-5.4-mini",
  projects: "anthropic:sonnet-4",
  communications: "openclaw:command",
};

type AgentWizardPanelProps = {
  open: boolean;
  initialAgent?: AgentRosterRow | null;
  mode?: "create" | "edit";
  onClose: () => void;
  onSaved?: () => void;
};

type AgentDraft = {
  id?: string;
  agentId: string;
  displayName: string;
  emoji: string;
  modelKey: string;
  role: string;
  domain: string;
  allowedTools: string[];
  allowedDomains: string[];
  status: AgentStatus;
  approvalMode: AgentApprovalMode;
  notes: string;
};

const buildDraftFromMission = (mission: string): AgentDraft => {
  const role = mission.trim();
  const domain = inferDomain(role);
  const firstSentence = role.split(".")[0]?.trim() || "New Agent";
  const displayName = firstSentence.length > 52 ? `${firstSentence.slice(0, 49)}...` : firstSentence;
  const agentId = slugify(displayName || "new-agent") || "new-agent";

  return {
    agentId,
    displayName,
    emoji: "◌",
    modelKey: defaultModelByDomain[domain] ?? "openai:gpt-5.4-mini",
    role: role || "Supports operational routing inside BukowskiOS.",
    domain,
    allowedTools: defaultToolsByDomain[domain] ?? ["workspace.search"],
    allowedDomains: defaultDomainsByDomain[domain] ?? [domain],
    status: "active",
    approvalMode: domain === "communications" ? "needs_approval" : "supervised",
    notes: "Created from the visual agent builder.",
  };
};

const buildDraftFromAgent = (agent: AgentRosterRow): AgentDraft => ({
  id: agent.id,
  agentId: agent.agentId,
  displayName: agent.displayName,
  emoji: agent.emoji,
  modelKey: agent.modelLabel.toLowerCase().includes("claude")
    ? "anthropic:sonnet-4"
    : agent.modelLabel.toLowerCase().includes("openclaw")
      ? "openclaw:command"
      : "openai:gpt-5.4-mini",
  role: agent.role,
  domain: agent.domain,
  allowedTools: agent.toolsSummary ? agent.toolsSummary.split("·").map((value) => value.trim()).filter(Boolean) : [],
  allowedDomains: agent.domainsSummary ? agent.domainsSummary.split("·").map((value) => value.trim()).filter(Boolean) : [],
  status: agent.status,
  approvalMode: agent.approvalMode,
  notes: agent.notes,
});

export const AgentWizardPanel = ({
  open,
  initialAgent = null,
  mode = "create",
  onClose,
  onSaved,
}: AgentWizardPanelProps) => {
  const [step, setStep] = useState(mode === "edit" ? 2 : 1);
  const [mission, setMission] = useState(initialAgent?.role ?? "");
  const [draft, setDraft] = useState<AgentDraft | null>(initialAgent ? buildDraftFromAgent(initialAgent) : null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStep(mode === "edit" ? 2 : 1);
    setMission(initialAgent?.role ?? "");
    setDraft(initialAgent ? buildDraftFromAgent(initialAgent) : null);
    setError(null);
    setIsSaving(false);
  }, [initialAgent, mode, open]);

  const isEdit = mode === "edit" && Boolean(initialAgent?.id);

  const examples = useMemo(
    () => ["Assets triage specialist", "Maintenance follow-up agent", "Projects schedule reviewer"],
    [],
  );

  if (!open) {
    return null;
  }

  const handleGenerateConfig = () => {
    const nextDraft = buildDraftFromMission(mission);
    setDraft(nextDraft);
    setStep(2);
    setError(null);
  };

  const handleSave = async () => {
    if (!draft) {
      setError("Generate or review a configuration first.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEdit && draft.id) {
        await updateAgent({
          commandId: `cmd-agent-update-${Date.now().toString(36)}`,
          workspaceId,
          id: draft.id,
          agentId: draft.agentId,
          displayName: draft.displayName,
          emoji: draft.emoji,
          modelKey: draft.modelKey,
          role: draft.role,
          domain: draft.domain,
          allowedTools: draft.allowedTools,
          allowedDomains: draft.allowedDomains,
          status: draft.status,
          approvalMode: draft.approvalMode,
          notes: draft.notes,
        });
      } else {
        await createAgent({
          commandId: `cmd-agent-create-${Date.now().toString(36)}`,
          workspaceId,
          agentId: draft.agentId,
          displayName: draft.displayName,
          emoji: draft.emoji,
          modelKey: draft.modelKey,
          role: draft.role,
          domain: draft.domain,
          allowedTools: draft.allowedTools,
          allowedDomains: draft.allowedDomains,
          status: draft.status,
          approvalMode: draft.approvalMode,
          notes: draft.notes,
        });
      }

      onSaved?.();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save agent.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="agent-wizard-backdrop" role="presentation">
      <section aria-modal="true" className="agent-wizard-modal" role="dialog">
        <header className="agent-wizard-header">
          <div>
            <span className="agent-wizard-step-label">Step {step} of 2</span>
            <h2 className="agent-wizard-title">{step === 1 ? "Create new agent" : "Review & configure"}</h2>
          </div>
          <button aria-label="Close agent builder" className="surface-card-action" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {step === 1 ? (
          <div className="agent-wizard-step">
            <p className="agent-wizard-copy">
              Describe what this agent should do, where it should operate and how supervised it needs to be.
            </p>
            <textarea
              className="field-textarea field-textarea-large"
              onChange={(event) => setMission(event.target.value)}
              placeholder="A maintenance agent that reviews damage, prepares RMA drafts and flags anything that needs approval before outreach."
              rows={6}
              value={mission}
            />

            <div className="agent-wizard-example-row">
              {examples.map((example) => (
                <button key={example} className="chip-button" onClick={() => setMission(example)} type="button">
                  {example}
                </button>
              ))}
            </div>

            {error ? <div className="form-inline-error">{error}</div> : null}

            <div className="agent-wizard-actions">
              <button className="ghost-control" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="primary-control" disabled={!mission.trim()} onClick={handleGenerateConfig} type="button">
                <Sparkles size={14} />
                <span>Generate config</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="agent-wizard-step agent-wizard-step-review">
            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">Agent ID</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, agentId: slugify(event.target.value) } : current))}
                  value={draft?.agentId ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Display name</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, displayName: event.target.value } : current))}
                  value={draft?.displayName ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Emoji / icon</span>
                <input
                  className="field-input"
                  maxLength={4}
                  onChange={(event) => setDraft((current) => (current ? { ...current, emoji: event.target.value } : current))}
                  value={draft?.emoji ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Model</span>
                <select
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, modelKey: event.target.value } : current))}
                  value={draft?.modelKey ?? "openai:gpt-5.4-mini"}
                >
                  <option value="openai:gpt-5.4">OpenAI · GPT-5.4</option>
                  <option value="openai:gpt-5.4-mini">OpenAI · GPT-5.4 Mini</option>
                  <option value="anthropic:sonnet-4">Anthropic · Sonnet 4</option>
                  <option value="openclaw:command">OpenClaw · Command</option>
                </select>
              </label>

              <label className="field-block">
                <span className="field-label">Domain</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, domain: event.target.value } : current))}
                  value={draft?.domain ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Status</span>
                <select
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, status: event.target.value as AgentStatus } : current))
                  }
                  value={draft?.status ?? "active"}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>

              <label className="field-block">
                <span className="field-label">Approval mode</span>
                <select
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, approvalMode: event.target.value as AgentApprovalMode } : current,
                    )
                  }
                  value={draft?.approvalMode ?? "supervised"}
                >
                  <option value="auto">Auto</option>
                  <option value="supervised">Supervised</option>
                  <option value="needs_approval">Needs approval</option>
                </select>
              </label>

              <label className="field-block field-block-span-2">
                <span className="field-label">Mission</span>
                <textarea
                  className="field-textarea"
                  onChange={(event) => setDraft((current) => (current ? { ...current, role: event.target.value } : current))}
                  rows={4}
                  value={draft?.role ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Allowed tools</span>
                <input
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            allowedTools: event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          }
                        : current,
                    )
                  }
                  value={(draft?.allowedTools ?? []).join(", ")}
                />
              </label>

              <label className="field-block">
                <span className="field-label">Allowed domains</span>
                <input
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            allowedDomains: event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          }
                        : current,
                    )
                  }
                  value={(draft?.allowedDomains ?? []).join(", ")}
                />
              </label>

              <label className="field-block field-block-span-2">
                <span className="field-label">Notes</span>
                <textarea
                  className="field-textarea"
                  onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))}
                  rows={3}
                  value={draft?.notes ?? ""}
                />
              </label>
            </div>

            {error ? <div className="form-inline-error">{error}</div> : null}

            <div className="agent-wizard-actions">
              <button className="ghost-control" onClick={() => setStep(1)} type="button">
                Refine
              </button>
              <div className="agent-wizard-actions-end">
                <button className="ghost-control" onClick={onClose} type="button">
                  Cancel
                </button>
                <button className="primary-control" disabled={isSaving} onClick={handleSave} type="button">
                  <span>{isSaving ? "Saving..." : isEdit ? "Update agent" : "Create agent"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
