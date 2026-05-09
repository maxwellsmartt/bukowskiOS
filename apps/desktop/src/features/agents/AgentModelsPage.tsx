import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, RadioTower, RotateCcw, ServerCog } from "lucide-react";

import type { AgentModelAssignmentRow, AgentModelRow } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getAgentProviderBrand } from "@shared/lib/agentProviderBranding";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  assignAgentModel,
  refreshAIProviderModels,
  saveAIProviderConfig,
  testAIProviderConnection,
  useAgentModels,
} from "./useAgentsData";

const providerStatusLabelMap: Record<AgentModelRow["status"], string> = {
  not_configured: "Not configured",
  configured: "Configured",
  testing: "Testing",
  healthy: "Healthy",
  invalid_key: "Invalid key",
  unavailable: "Unavailable",
};

const providerStatusIndicatorToneMap: Record<AgentModelRow["status"], "green" | "amber" | "red"> = {
  healthy: "green",
  configured: "amber",
  testing: "amber",
  not_configured: "amber",
  invalid_key: "red",
  unavailable: "red",
};

const providerDisplayOrder = ["openai", "anthropic", "openclaw", "custom"] as const;

type ProviderDraft = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModelKey: string;
  fallbackModelKey: string;
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
  fallbackModelKey: provider?.fallbackModelKey ?? "",
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
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const toast = useToast();
  const { data, error } = useAgentModels();
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(buildProviderDraft(null));
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [assignmentBusyAgentId, setAssignmentBusyAgentId] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => data.providers.find((provider) => provider.providerKey === selectedProviderKey) ?? null,
    [data.providers, selectedProviderKey],
  );
  const orderedProviders = useMemo(
    () =>
      [...data.providers].sort((left, right) => {
        const leftOrder = providerDisplayOrder.indexOf(left.providerKey as (typeof providerDisplayOrder)[number]);
        const rightOrder = providerDisplayOrder.indexOf(right.providerKey as (typeof providerDisplayOrder)[number]);

        if (leftOrder !== -1 || rightOrder !== -1) {
          if (leftOrder === -1) {
            return 1;
          }

          if (rightOrder === -1) {
            return -1;
          }

          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
        }

        return left.label.localeCompare(right.label);
      }),
    [data.providers],
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
    setAssignmentDrafts(buildAssignmentDraftMap(data.assignments));
  }, [data.assignments]);

  const summaryCards = useMemo(
    () => [
      { label: "Active services", value: data.summary.activeProviders },
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
        fallbackModelKey: providerDraft.fallbackModelKey,
        timeoutMs: providerDraft.timeoutMs,
        retryCount: providerDraft.retryCount,
      });

      toast.success("Provider saved", result.summary);
      setProviderDraft((current) => ({
        ...current,
        apiKey: "",
      }));
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, "Unable to save provider configuration."));
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleClearStoredKey = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsSavingProvider(true);
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
        fallbackModelKey: providerDraft.fallbackModelKey,
        timeoutMs: providerDraft.timeoutMs,
        retryCount: providerDraft.retryCount,
      });

      toast.success("Provider key cleared", result.summary);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, "Unable to clear the stored API key."));
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleRefreshModels = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsRefreshingModels(true);
    setErrorMessage(null);

    try {
      const result = await refreshAIProviderModels({
        workspaceId,
        providerKey: selectedProvider.providerKey,
      });
      toast.success("Models refreshed", result.summary);
    } catch (refreshError) {
      setErrorMessage(getUserFacingErrorMessage(refreshError, "Unable to refresh model options."));
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const handleTestProvider = async () => {
    if (!selectedProvider) {
      return;
    }

    setIsTestingProvider(true);
    setErrorMessage(null);

    try {
      const result = await testAIProviderConnection({
        workspaceId,
        providerKey: selectedProvider.providerKey,
      });
      toast.success("Provider tested", result.summary);
    } catch (testError) {
      setErrorMessage(getUserFacingErrorMessage(testError, "Unable to test the provider connection."));
    } finally {
      setIsTestingProvider(false);
    }
  };

  const handleAssignmentFieldChange = (agentId: string, field: keyof AssignmentDraft, value: string) => {
    setAssignmentDrafts((current) => {
      const previous = current[agentId];
      const next = {
        providerKey: previous?.providerKey ?? "openai",
        modelKey: previous?.modelKey ?? "openai:gpt-5-mini",
        modelLabel: previous?.modelLabel ?? "GPT-5 Mini",
      };

      next[field] = value;

      if (field === "providerKey") {
        const fallbackModel = data.providers.find((provider) => provider.providerKey === value)?.modelOptions[0];
        next.modelKey = fallbackModel?.key ?? `${value}:default`;
        next.modelLabel = fallbackModel?.label ?? "Default model";
      }

      if (field === "modelKey") {
        const selectedOption = data.providers
          .find((provider) => provider.providerKey === next.providerKey)
          ?.modelOptions.find((option) => option.key === value);
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

      toast.success("Agent model updated", result.summary);
    } catch (assignmentError) {
      setErrorMessage(getUserFacingErrorMessage(assignmentError, "Unable to update the agent assignment."));
    } finally {
      setAssignmentBusyAgentId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="AI Models" titleTone="accent" />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className="agents-models-layout">
        <SurfaceCard title="AI Services">
          {error ? <div className="empty-state">AI models unavailable: {error}</div> : null}

          <div className="models-provider-list">
            {orderedProviders.map((provider) => (
              (() => {
                const providerBrand = getAgentProviderBrand(provider.providerKey);
                const indicatorTone = providerStatusIndicatorToneMap[provider.status];

                return (
                  <button
                    key={provider.id}
                    className={`models-provider-row${selectedProviderKey === provider.providerKey ? " is-selected" : ""}${
                      provider.isActiveProvider ? " is-active-provider" : " is-inactive-provider"
                    }`}
                    onClick={() => setSelectedProviderKey(provider.providerKey)}
                    type="button"
                  >
                    <span
                      aria-label={providerStatusLabelMap[provider.status]}
                      className={`agent-live-dot agent-live-dot-${indicatorTone}`}
                      data-tooltip={`${provider.label} · ${providerStatusLabelMap[provider.status]}`}
                    />
                    <div className="models-provider-row-copy">
                      <div className="models-provider-row-topline">
                        <strong className="provider-heading">
                          {providerBrand.logoSrc ? (
                            <img
                              alt={providerBrand.logoAlt ?? provider.label}
                              className={`provider-heading-logo${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                              src={providerBrand.logoSrc}
                            />
                          ) : null}
                          <span>{provider.label}</span>
                        </strong>
                        {!provider.supportsLiveRequests ? <span className="subtle-pill">Coming soon</span> : null}
                      </div>
                      <div className="agent-detail-row">
                        <span className={`run-status-pill run-status-pill-${provider.status}`}>
                          {providerStatusLabelMap[provider.status]}
                        </span>
                        <span>{provider.assignedAgents.length} agents</span>
                        {provider.hasStoredSecret ? (
                          <span className="subtle-pill">
                            <KeyRound size={12} />
                            <span>Key stored</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })()
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard
          title={
            selectedProvider ? (
              <span className="provider-heading">
                {(() => {
                  const providerBrand = getAgentProviderBrand(selectedProvider.providerKey);
                  return providerBrand.logoSrc ? (
                    <img
                      alt={providerBrand.logoAlt ?? selectedProvider.label}
                      className={`provider-heading-logo provider-heading-logo-detail${providerBrand.logoClassName ? ` ${providerBrand.logoClassName}` : ""}`}
                      src={providerBrand.logoSrc}
                    />
                  ) : null;
                })()}
                <span>{selectedProvider.label}</span>
              </span>
            ) : (
              "Select an AI service"
            )
          }
          aside={
            selectedProvider ? (
              <div className="agent-detail-row">
                <span
                  aria-label={providerStatusLabelMap[selectedProvider.status]}
                  className={`agent-live-dot agent-live-dot-${providerStatusIndicatorToneMap[selectedProvider.status]}`}
                  data-tooltip={`${selectedProvider.label} · ${providerStatusLabelMap[selectedProvider.status]}`}
                />
                {!selectedProvider.supportsLiveRequests ? <span className="subtle-pill">Coming soon</span> : null}
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
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Models synced</span>
                  <strong>{selectedProvider.modelsLastSyncedAtLabel}</strong>
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
                      selectedProvider.hasStoredSecret ? "Leave blank to keep the stored key" : "Paste the API key"
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
                    placeholder="Optional custom endpoint"
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
                    {selectedProvider.modelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}{option.source === "api" ? "" : " · default"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">Fallback model</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("fallbackModelKey", event.target.value)}
                    value={providerDraft.fallbackModelKey}
                  >
                    <option value="">No fallback</option>
                    {selectedProvider.modelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}{option.source === "api" ? "" : " · default"}
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

              {errorMessage ? <div className="form-inline-error">{errorMessage}</div> : null}

              <div className="agent-detail-actions">
                <button
                  className="primary-control"
                  disabled={!selectedProvider.supportsLiveRequests || isSavingProvider}
                  onClick={handleSaveProvider}
                  type="button"
                >
                  <CheckCircle2 size={14} />
                  <span>{isSavingProvider ? "Saving..." : "Save"}</span>
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
                <button
                  className="ghost-control"
                  disabled={!selectedProvider.supportsLiveRequests || isRefreshingModels || !selectedProvider.hasStoredSecret}
                  onClick={handleRefreshModels}
                  type="button"
                >
                  <RotateCcw size={14} />
                  <span>{isRefreshingModels ? "Refreshing..." : "Refresh models"}</span>
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
            <div className="empty-state">Select an AI service to review its setup and health.</div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard title="Assignments">
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
                  <p>{assignment.isSupervisor ? "Supervisor" : assignment.providerLabel}</p>
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
                    {(data.providers.find((provider) => provider.providerKey === draft.providerKey)?.modelOptions ?? []).map((option) => (
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
