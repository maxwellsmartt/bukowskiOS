import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, RadioTower, RotateCcw, ServerCog } from "lucide-react";

import type { AgentModelAssignmentRow, AgentModelRow } from "@contracts";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import {
  assignAgentModel,
  saveAIProviderConfig,
  testAIProviderConnection,
  useAgentModels,
} from "./useAgentsData";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const providerStatusLabelMap: Record<AgentModelRow["status"], string> = {
  not_configured: "Not configured",
  configured: "Configured",
  testing: "Testing",
  healthy: "Healthy",
  invalid_key: "Invalid key",
  unavailable: "Unavailable",
};

const providerStatusSummaryMap: Record<AgentModelRow["status"], string> = {
  not_configured: "Waiting for API credentials before this provider can answer real requests.",
  configured: "Configured locally. Run a health test before routing live chat through it.",
  testing: "A connection test is currently in progress.",
  healthy: "Ready for supervised routing from the Agents chat.",
  invalid_key: "The stored API key was rejected. Replace it before enabling this provider.",
  unavailable: "The provider could not be reached with the current configuration.",
};

const providerModelOptions: Record<string, Array<{ key: string; label: string }>> = {
  openai: [
    { key: "openai:gpt-5.4", label: "GPT-5.4" },
    { key: "openai:gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
  anthropic: [{ key: "anthropic:sonnet-4", label: "Claude Sonnet 4" }],
  openclaw: [{ key: "openclaw:command", label: "OpenClaw Command" }],
  custom: [{ key: "custom:gateway-default", label: "Gateway Default" }],
};

type ProviderDraft = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModelKey: string;
  timeoutMs: number;
  retryCount: number;
};

type AssignmentDraft = {
  providerKey: string;
  modelKey: string;
  modelLabel: string;
};

const buildProviderDraft = (provider: AgentModelRow | null): ProviderDraft => ({
  enabled: provider?.enabled ?? false,
  apiKey: "",
  baseUrl: provider?.baseUrl ?? "",
  defaultModelKey: provider?.defaultModelKey ?? "",
  timeoutMs: provider?.timeoutMs ?? 30_000,
  retryCount: provider?.retryCount ?? 1,
});

const buildAssignmentDraftMap = (assignments: AgentModelAssignmentRow[]) =>
  assignments.reduce<Record<string, AssignmentDraft>>((accumulator, assignment) => {
    accumulator[assignment.agentId] = {
      providerKey: assignment.providerKey,
      modelKey: assignment.modelKey,
      modelLabel: assignment.modelLabel,
    };
    return accumulator;
  }, {});

export const AgentModelsPage = () => {
  const { data, error } = useAgentModels();
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(buildProviderDraft(null));
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [assignmentBusyAgentId, setAssignmentBusyAgentId] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => data.providers.find((provider) => provider.providerKey === selectedProviderKey) ?? null,
    [data.providers, selectedProviderKey],
  );

  useEffect(() => {
    if (!selectedProviderKey && data.providers.length) {
      setSelectedProviderKey(data.providers[0]?.providerKey ?? null);
    }
  }, [data.providers, selectedProviderKey]);

  useEffect(() => {
    setProviderDraft(buildProviderDraft(selectedProvider));
    setErrorMessage(null);
  }, [selectedProvider]);

  useEffect(() => {
    setFeedback(null);
  }, [selectedProviderKey]);

  useEffect(() => {
    setAssignmentDrafts(buildAssignmentDraftMap(data.assignments));
  }, [data.assignments]);

  const summaryCards = useMemo(
    () => [
      { label: "Active providers", value: data.summary.activeProviders },
      { label: "Configured", value: data.summary.configuredProviders },
      { label: "Healthy", value: data.summary.healthyProviders },
      { label: "Assigned agents", value: data.summary.assignedAgents },
    ],
    [data.summary],
  );

  const handleProviderFieldChange = <K extends keyof ProviderDraft>(field: K, value: ProviderDraft[K]) => {
    setProviderDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSaveProvider = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsSavingProvider(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await saveAIProviderConfig({
        commandId: `cmd-provider-save-${Date.now().toString(36)}`,
        workspaceId,
        providerKey: selectedProvider.providerKey,
        enabled: providerDraft.enabled,
        apiKey: providerDraft.apiKey,
        baseUrl: providerDraft.baseUrl,
        defaultModelKey: providerDraft.defaultModelKey,
        timeoutMs: providerDraft.timeoutMs,
        retryCount: providerDraft.retryCount,
      });

      setFeedback(result.summary);
      setProviderDraft((current) => ({
        ...current,
        apiKey: "",
      }));
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Unable to save provider configuration.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleClearStoredKey = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsSavingProvider(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await saveAIProviderConfig({
        commandId: `cmd-provider-clear-${Date.now().toString(36)}`,
        workspaceId,
        providerKey: selectedProvider.providerKey,
        enabled: false,
        clearStoredKey: true,
        baseUrl: providerDraft.baseUrl,
        defaultModelKey: providerDraft.defaultModelKey,
        timeoutMs: providerDraft.timeoutMs,
        retryCount: providerDraft.retryCount,
      });

      setFeedback(result.summary);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Unable to clear the stored API key.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleTestProvider = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsTestingProvider(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await testAIProviderConnection({
        workspaceId,
        providerKey: selectedProvider.providerKey,
      });
      setFeedback(result.summary);
    } catch (testError) {
      setErrorMessage(testError instanceof Error ? testError.message : "Unable to test the provider connection.");
    } finally {
      setIsTestingProvider(false);
    }
  };

  const handleAssignmentFieldChange = (agentId: string, field: keyof AssignmentDraft, value: string) => {
    setAssignmentDrafts((current) => {
      const previous = current[agentId];
      const next = {
        providerKey: previous?.providerKey ?? "openai",
        modelKey: previous?.modelKey ?? "openai:gpt-5.4-mini",
        modelLabel: previous?.modelLabel ?? "GPT-5.4 Mini",
      };

      next[field] = value;

      if (field === "providerKey") {
        const fallbackModel = providerModelOptions[value]?.[0];
        next.modelKey = fallbackModel?.key ?? `${value}:default`;
        next.modelLabel = fallbackModel?.label ?? "Default model";
      }

      if (field === "modelKey") {
        const selectedOption = providerModelOptions[next.providerKey]?.find((option) => option.key === value);
        next.modelLabel = selectedOption?.label ?? value;
      }

      return {
        ...current,
        [agentId]: next,
      };
    });
  };

  const handleSaveAssignment = async (assignment: AgentModelAssignmentRow) => {
    const draft = assignmentDrafts[assignment.agentId];

    if (!draft) {
      return;
    }

    setAssignmentBusyAgentId(assignment.agentId);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await assignAgentModel({
        commandId: `cmd-agent-model-${Date.now().toString(36)}`,
        workspaceId,
        agentId: assignment.agentId,
        providerKey: draft.providerKey,
        modelKey: draft.modelKey,
        modelLabel: draft.modelLabel,
      });

      setFeedback(result.summary);
    } catch (assignmentError) {
      setErrorMessage(assignmentError instanceof Error ? assignmentError.message : "Unable to update the agent assignment.");
    } finally {
      setAssignmentBusyAgentId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Models"
        titleTone="accent"
        body="Configure live providers, verify their health and keep agent-to-model routing honest before chat starts using real AI."
      />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className="agents-models-layout">
        <SurfaceCard title="Providers" subtitle="One real provider now, future shells kept visible without pretending they already work.">
          {error ? <div className="empty-state">Models unavailable: {error}</div> : null}

          <div className="models-provider-list">
            {data.providers.map((provider) => (
              <button
                key={provider.id}
                className={`models-provider-row${selectedProviderKey === provider.providerKey ? " is-selected" : ""}`}
                onClick={() => setSelectedProviderKey(provider.providerKey)}
                type="button"
              >
                <div className="models-provider-row-copy">
                  <div className="models-provider-row-topline">
                    <strong>{provider.label}</strong>
                    {provider.isActiveProvider ? <span className="subtle-pill">Active</span> : null}
                    {!provider.supportsLiveRequests ? <span className="subtle-pill">Shell</span> : null}
                  </div>
                  <p>{providerStatusSummaryMap[provider.status]}</p>
                  <div className="agent-detail-row">
                    <span className={`run-status-pill run-status-pill-${provider.status}`}>
                      {providerStatusLabelMap[provider.status]}
                    </span>
                    <span className="subtle-pill">{provider.assignedAgents.length} agents</span>
                    {provider.hasStoredSecret ? (
                      <span className="subtle-pill">
                        <KeyRound size={12} />
                        <span>Key stored</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard
          title={selectedProvider?.label ?? "Select a provider"}
          subtitle={
            selectedProvider
              ? "Provider configuration lives in the main process. Secrets never return to the renderer."
              : "Choose a provider from the left to configure it here."
          }
          aside={
            selectedProvider ? (
              <div className="agent-detail-row">
                {selectedProvider.isActiveProvider ? <span className="subtle-pill">Currently active</span> : null}
                {!selectedProvider.supportsLiveRequests ? <span className="subtle-pill">Future shell</span> : null}
              </div>
            ) : null
          }
        >
          {selectedProvider ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`run-status-pill run-status-pill-${selectedProvider.status}`}>
                  {providerStatusLabelMap[selectedProvider.status]}
                </span>
                <span className="subtle-pill">
                  <ServerCog size={12} />
                  <span>{selectedProvider.defaultModelKey}</span>
                </span>
                {selectedProvider.hasStoredSecret ? (
                  <span className="subtle-pill">
                    <KeyRound size={12} />
                    <span>Stored on this Mac</span>
                  </span>
                ) : null}
              </div>

              <div className="models-provider-health-grid">
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Last tested</span>
                  <strong>{selectedProvider.lastTestedAtLabel}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Last success</span>
                  <strong>{selectedProvider.lastSuccessAtLabel}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Assigned models</span>
                  <strong>{selectedProvider.assignedModels.join(" · ") || "None yet"}</strong>
                </div>
              </div>

              <div className="action-form-grid">
                <label className="field-block field-block-span-2">
                  <span className="field-label">API key</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("apiKey", event.target.value)}
                    placeholder={
                      selectedProvider.hasStoredSecret ? "Leave blank to keep the stored key" : "Paste the OpenAI API key"
                    }
                    type="password"
                    value={providerDraft.apiKey}
                  />
                </label>
                <label className="field-block field-block-span-2">
                  <span className="field-label">Base URL override</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("baseUrl", event.target.value)}
                    placeholder="Optional future gateway override"
                    value={providerDraft.baseUrl}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Default model</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("defaultModelKey", event.target.value)}
                    value={providerDraft.defaultModelKey}
                  >
                    {(providerModelOptions[selectedProvider.providerKey] ?? []).map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">Enabled</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("enabled", event.target.value === "true")}
                    value={String(providerDraft.enabled)}
                  >
                    <option value="false">Disabled</option>
                    <option value="true">Enabled</option>
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">Timeout (ms)</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    min={3000}
                    onChange={(event) => handleProviderFieldChange("timeoutMs", Number(event.target.value) || 30000)}
                    step={1000}
                    type="number"
                    value={providerDraft.timeoutMs}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Retry count</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    max={5}
                    min={0}
                    onChange={(event) => handleProviderFieldChange("retryCount", Number(event.target.value) || 0)}
                    type="number"
                    value={providerDraft.retryCount}
                  />
                </label>
              </div>

              {selectedProvider.lastErrorSummary ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">Last error</span>
                  <p>{selectedProvider.lastErrorSummary}</p>
                </div>
              ) : null}

              {feedback ? <div className="models-provider-feedback models-provider-feedback-success">{feedback}</div> : null}
              {errorMessage ? <div className="form-inline-error">{errorMessage}</div> : null}

              <div className="agent-detail-actions">
                <button
                  className="primary-control"
                  disabled={!selectedProvider.supportsLiveRequests || isSavingProvider}
                  onClick={handleSaveProvider}
                  type="button"
                >
                  <CheckCircle2 size={14} />
                  <span>{isSavingProvider ? "Saving..." : "Save config"}</span>
                </button>
                <button
                  className="ghost-control"
                  disabled={!selectedProvider.supportsLiveRequests || isTestingProvider}
                  onClick={handleTestProvider}
                  type="button"
                >
                  <RadioTower size={14} />
                  <span>{isTestingProvider ? "Testing..." : "Test connection"}</span>
                </button>
                {selectedProvider.hasStoredSecret ? (
                  <button className="ghost-control" disabled={isSavingProvider} onClick={handleClearStoredKey} type="button">
                    <RotateCcw size={14} />
                    <span>Clear stored key</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a provider to inspect its configuration, health and local secret posture.</div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard
        title="Agent-to-model assignment"
        subtitle="Keep provider usage explicit so routing stays readable before the real gateway starts answering chat."
      >
        <div className="models-assignment-list">
          {data.assignments.map((assignment) => {
            const draft = assignmentDrafts[assignment.agentId] ?? {
              providerKey: assignment.providerKey,
              modelKey: assignment.modelKey,
              modelLabel: assignment.modelLabel,
            };

            return (
              <div key={assignment.agentId} className="models-assignment-row">
                <div className="models-assignment-copy">
                  <strong>{assignment.displayName}</strong>
                  <p>{assignment.isSupervisor ? "Supervisor / Orchestrator" : assignment.providerLabel}</p>
                </div>

                <div className="models-assignment-controls">
                  <select
                    className="field-input"
                    onChange={(event) => handleAssignmentFieldChange(assignment.agentId, "providerKey", event.target.value)}
                    value={draft.providerKey}
                  >
                    {data.providers.map((provider) => (
                      <option key={provider.providerKey} value={provider.providerKey}>
                        {provider.label}
                      </option>
                    ))}
                  </select>

                  <select
                    className="field-input"
                    onChange={(event) => handleAssignmentFieldChange(assignment.agentId, "modelKey", event.target.value)}
                    value={draft.modelKey}
                  >
                    {(providerModelOptions[draft.providerKey] ?? []).map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    className="ghost-control"
                    disabled={assignmentBusyAgentId === assignment.agentId}
                    onClick={() => handleSaveAssignment(assignment)}
                    type="button"
                  >
                    <span>{assignmentBusyAgentId === assignment.agentId ? "Saving..." : "Assign"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SurfaceCard>
    </div>
  );
};
