import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentApprovalMode, AgentRosterRow, AgentStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { createAgent, updateAgent } from "./useAgentsData";

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
  assets: "openai:gpt-5-mini",
  incidents: "anthropic:claude-sonnet-4-20250514",
  finance: "openai:gpt-5-mini",
  projects: "anthropic:claude-sonnet-4-20250514",
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
  mission: string;
  domain: string;
  allowedTools: string[];
  allowedDomains: string[];
  status: AgentStatus;
  approvalMode: AgentApprovalMode;
  notes: string;
};

const buildDraftFromMission = (mission: string, t: TFunction): AgentDraft => {
  const missionText = mission.trim();
  const domain = inferDomain(missionText);
  const firstSentence = missionText.split(".")[0]?.trim() || t("agents.wizard.defaults.newAgent");
  const displayName = firstSentence.length > 52 ? `${firstSentence.slice(0, 49)}...` : firstSentence;
  const agentId = slugify(displayName || "new-agent") || "new-agent";
  const defaultRole = t("agents.wizard.defaults.role", { name: displayName || t("agents.wizard.defaults.new") });

  return {
    agentId,
    displayName,
    emoji: "◌",
    modelKey: defaultModelByDomain[domain] ?? "openai:gpt-5-mini",
    role: defaultRole,
    mission: missionText || t("agents.wizard.defaults.mission"),
    domain,
    allowedTools: defaultToolsByDomain[domain] ?? ["workspace.search"],
    allowedDomains: defaultDomainsByDomain[domain] ?? [domain],
    status: "active",
    approvalMode: domain === "communications" ? "needs_approval" : "supervised",
    notes: t("agents.wizard.defaults.notes"),
  };
};

const buildDraftFromAgent = (agent: AgentRosterRow): AgentDraft => ({
  id: agent.id,
  agentId: agent.agentId,
  displayName: agent.displayName,
  emoji: agent.emoji,
  modelKey: agent.modelLabel.toLowerCase().includes("claude")
    ? "anthropic:claude-sonnet-4-20250514"
    : agent.modelLabel.toLowerCase().includes("openclaw")
      ? "openclaw:command"
      : "openai:gpt-5-mini",
  role: agent.role,
  mission: agent.mission,
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
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
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
    () => [
      t("agents.wizard.examples.assets"),
      t("agents.wizard.examples.maintenance"),
      t("agents.wizard.examples.projects"),
    ],
    [t],
  );

  if (!open) {
    return null;
  }

  const handleGenerateConfig = () => {
    const nextDraft = buildDraftFromMission(mission, t);
    setDraft(nextDraft);
    setStep(2);
    setError(null);
  };

  const handleSave = async () => {
    if (!draft) {
      setError(t("agents.wizard.errors.generateFirst"));
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
          mission: draft.mission,
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
          mission: draft.mission,
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
      setError(getUserFacingErrorMessage(nextError, t("agents.wizard.errors.save")));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="agent-wizard-backdrop" role="presentation">
      <section aria-modal="true" className="agent-wizard-modal" role="dialog">
        <header className="agent-wizard-header">
          <div>
            <span className="agent-wizard-step-label">{t("agents.wizard.stepLabel", { step, total: 2 })}</span>
            <h2 className="agent-wizard-title">{step === 1 ? t("agents.wizard.createTitle") : t("agents.wizard.reviewTitle")}</h2>
          </div>
          <button aria-label={t("agents.wizard.close")} className="icon-ghost-control" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {step === 1 ? (
          <div className="agent-wizard-step">
            <p className="agent-wizard-copy">
              {t("agents.wizard.intro")}
            </p>
            <textarea
              className="field-textarea field-textarea-large"
              onChange={(event) => setMission(event.target.value)}
              placeholder={t("agents.wizard.placeholder")}
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
              <button className="ghost-control cancel-control" onClick={onClose} type="button">
                {t("common.cancel")}
              </button>
              <button className="primary-control" disabled={!mission.trim()} onClick={handleGenerateConfig} type="button">
                <Sparkles size={14} />
                <span>{t("agents.wizard.generateConfig")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="agent-wizard-step agent-wizard-step-review">
            <div className="agent-form-grid">
              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.agentId")}</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, agentId: slugify(event.target.value) } : current))}
                  value={draft?.agentId ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.displayName")}</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, displayName: event.target.value } : current))}
                  value={draft?.displayName ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.icon")}</span>
                <input
                  className="field-input"
                  maxLength={4}
                  onChange={(event) => setDraft((current) => (current ? { ...current, emoji: event.target.value } : current))}
                  value={draft?.emoji ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.model")}</span>
                <select
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, modelKey: event.target.value } : current))}
                  value={draft?.modelKey ?? "openai:gpt-5-mini"}
                >
                  <option value="openai:gpt-5.2">OpenAI · GPT-5.2</option>
                  <option value="openai:gpt-5-mini">OpenAI · GPT-5 Mini</option>
                  <option value="anthropic:claude-sonnet-4-20250514">Anthropic · Claude Sonnet 4</option>
                  <option value="anthropic:claude-opus-4-1-20250805">Anthropic · Claude Opus 4.1</option>
                  <option value="openclaw:command">OpenClaw · Command</option>
                </select>
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.domain")}</span>
                <input
                  className="field-input"
                  onChange={(event) => setDraft((current) => (current ? { ...current, domain: event.target.value } : current))}
                  value={draft?.domain ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.status")}</span>
                <select
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, status: event.target.value as AgentStatus } : current))
                  }
                  value={draft?.status ?? "active"}
                >
                  <option value="active">{t("agents.shared.agentStatus.active")}</option>
                  <option value="paused">{t("agents.shared.agentStatus.paused")}</option>
                </select>
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.approvalMode")}</span>
                <select
                  className="field-input"
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, approvalMode: event.target.value as AgentApprovalMode } : current,
                    )
                  }
                  value={draft?.approvalMode ?? "supervised"}
                >
                  <option value="auto">{t("agents.wizard.approval.auto")}</option>
                  <option value="supervised">{t("agents.wizard.approval.supervised")}</option>
                  <option value="needs_approval">{t("agents.wizard.approval.needsApproval")}</option>
                </select>
              </label>

              <label className="field-block field-block-span-2">
                <span className="field-label">{t("agents.wizard.fields.role")}</span>
                <textarea
                  className="field-textarea"
                  onChange={(event) => setDraft((current) => (current ? { ...current, role: event.target.value } : current))}
                  rows={2}
                  value={draft?.role ?? ""}
                />
              </label>

              <label className="field-block field-block-span-2">
                <span className="field-label">{t("agents.wizard.fields.mission")}</span>
                <textarea
                  className="field-textarea"
                  onChange={(event) => setDraft((current) => (current ? { ...current, mission: event.target.value } : current))}
                  rows={4}
                  value={draft?.mission ?? ""}
                />
              </label>

              <label className="field-block">
                <span className="field-label">{t("agents.wizard.fields.allowedTools")}</span>
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
                <span className="field-label">{t("agents.wizard.fields.allowedDomains")}</span>
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
                <span className="field-label">{t("agents.wizard.fields.notes")}</span>
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
                {t("agents.wizard.refine")}
              </button>
              <div className="agent-wizard-actions-end">
                <button className="ghost-control cancel-control" onClick={onClose} type="button">
                  {t("common.cancel")}
                </button>
                <button className="primary-control" disabled={isSaving} onClick={handleSave} type="button">
                  <span>{isSaving ? t("common.saving") : isEdit ? t("agents.wizard.updateAgent") : t("agents.wizard.createAgent")}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
