import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, RadioTower, RotateCcw, ServerCog } from "lucide-react";
import { useTranslation } from "react-i18next";

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

const providerStatusIndicatorToneMap: Record<AgentModelRow["status"], "green" | "amber" | "red"> = {
  healthy: "green",
  configured: "amber",
  testing: "amber",
  not_configured: "amber",
  invalid_key: "red",
  unavailable: "red",
};

const providerDisplayOrder = ["openai", "anthropic", "openclaw", "custom"] as const;

const canAssignProvider = (provider: AgentModelRow | undefined) =>
  Boolean(provider?.supportsLiveRequests && provider.enabled && (provider.status === "configured" || provider.status === "healthy"));

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

const looksLikeOpenAIDashboardUrl = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("platform.openai.com") || normalized.includes("/api-keys");
};

export const AgentModelsPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const toast = useToast();
  const { data, error } = useAgentModels({ workspaceId });
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
      { label: t("agents.models.summary.activeServices"), value: data.summary.activeProviders },
      { label: t("agents.models.summary.configured"), value: data.summary.configuredProviders },
      { label: t("agents.models.summary.healthy"), value: data.summary.healthyProviders },
      { label: t("agents.models.summary.assignedAgents"), value: data.summary.assignedAgents },
    ],
    [data.summary, t],
  );
  const baseUrlHelper = useMemo(() => {
    if (!selectedProvider?.supportsLiveRequests) {
      return null;
    }

    if (selectedProvider.providerKey === "openai") {
      return looksLikeOpenAIDashboardUrl(providerDraft.baseUrl)
        ? { tone: "warning" as const, text: t("agents.models.helpers.openaiDashboardUrl") }
        : { tone: "default" as const, text: t("agents.models.helpers.openaiBaseUrl") };
    }

    if (selectedProvider.providerKey === "anthropic") {
      return { tone: "default" as const, text: t("agents.models.helpers.anthropicBaseUrl") };
    }

    return null;
  }, [providerDraft.baseUrl, selectedProvider, t]);
  const providerStatusLabel = (status: AgentModelRow["status"]) =>
    t(`agents.models.status.${status}`, { defaultValue: status });

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

      toast.success(t("agents.models.toasts.providerSaved"), result.summary);
      setProviderDraft((current) => ({
        ...current,
        apiKey: "",
      }));
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, t("agents.models.errors.saveProvider")));
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

      toast.success(t("agents.models.toasts.keyCleared"), result.summary);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, t("agents.models.errors.clearKey")));
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
      toast.success(t("agents.models.toasts.modelsRefreshed"), result.summary);
    } catch (refreshError) {
      setErrorMessage(getUserFacingErrorMessage(refreshError, t("agents.models.errors.refreshModels")));
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
      toast.success(t("agents.models.toasts.providerTested"), result.summary);
    } catch (testError) {
      setErrorMessage(getUserFacingErrorMessage(testError, t("agents.models.errors.testProvider")));
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
        next.modelLabel = fallbackModel?.label ?? t("agents.models.defaultModel");
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

      toast.success(t("agents.models.toasts.assignmentUpdated"), result.summary);
    } catch (assignmentError) {
      setErrorMessage(getUserFacingErrorMessage(assignmentError, t("agents.models.errors.updateAssignment")));
    } finally {
      setAssignmentBusyAgentId(null);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("agents.models.title")} titleTone="accent" />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className="agents-models-layout">
        <SurfaceCard title={t("agents.models.services")}>
          {error ? <div className="empty-state">{t("agents.models.unavailable", { message: error })}</div> : null}

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
                      aria-label={providerStatusLabel(provider.status)}
                      className={`agent-live-dot agent-live-dot-${indicatorTone}`}
                      data-tooltip={`${provider.label} · ${providerStatusLabel(provider.status)}`}
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
                        {!provider.supportsLiveRequests ? <span className="subtle-pill">{t("agents.models.comingSoon")}</span> : null}
                      </div>
                      <div className="agent-detail-row">
                        <span className={`run-status-pill run-status-pill-${provider.status}`}>
                          {providerStatusLabel(provider.status)}
                        </span>
                        <span>{t("agents.models.assignedAgentCount", { count: provider.assignedAgents.length })}</span>
                        {provider.hasStoredSecret ? (
                          <span className="subtle-pill">
                            <KeyRound size={12} />
                            <span>{t("agents.models.keyStored")}</span>
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
          className="detail-rail-card agent-model-detail-card"
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
              t("agents.models.selectService")
            )
          }
          aside={
            selectedProvider ? (
              <div className="agent-detail-row">
                <span
                  aria-label={providerStatusLabel(selectedProvider.status)}
                  className={`agent-live-dot agent-live-dot-${providerStatusIndicatorToneMap[selectedProvider.status]}`}
                  data-tooltip={`${selectedProvider.label} · ${providerStatusLabel(selectedProvider.status)}`}
                />
                {!selectedProvider.supportsLiveRequests ? <span className="subtle-pill">{t("agents.models.comingSoon")}</span> : null}
              </div>
            ) : null
          }
        >
          {selectedProvider ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`run-status-pill run-status-pill-${selectedProvider.status}`}>
                  {providerStatusLabel(selectedProvider.status)}
                </span>
                <span className="subtle-pill">
                  <ServerCog size={12} />
                  <span>{selectedProvider.defaultModelKey}</span>
                </span>
                {selectedProvider.hasStoredSecret ? (
                  <span className="subtle-pill">
                    <KeyRound size={12} />
                    <span>{t("agents.models.storedOnThisMac")}</span>
                  </span>
                ) : null}
              </div>

              <div className="models-provider-health-grid">
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">{t("agents.models.lastTested")}</span>
                  <strong>{selectedProvider.lastTestedAtLabel}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">{t("agents.models.lastSuccess")}</span>
                  <strong>{selectedProvider.lastSuccessAtLabel}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">{t("agents.models.assignedModels")}</span>
                  <strong>{selectedProvider.assignedModels.join(" · ") || t("agents.models.noneYet")}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">{t("agents.models.modelsSynced")}</span>
                  <strong>{selectedProvider.modelsLastSyncedAtLabel}</strong>
                </div>
              </div>

              <div className="action-form-grid">
                <label className="field-block field-block-span-2">
                  <span className="field-label">{t("agents.models.fields.apiKey")}</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("apiKey", event.target.value)}
                    placeholder={
                      selectedProvider.hasStoredSecret ? t("agents.models.placeholders.keepStoredKey") : t("agents.models.placeholders.apiKey")
                    }
                    type="password"
                    value={providerDraft.apiKey}
                  />
                </label>
                <label className="field-block field-block-span-2">
                  <span className="field-label">{t("agents.models.fields.baseUrl")}</span>
                  <input
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("baseUrl", event.target.value)}
                    placeholder={t("agents.models.placeholders.baseUrl")}
                    value={providerDraft.baseUrl}
                  />
                  {baseUrlHelper ? (
                    <small className={`field-helper${baseUrlHelper.tone === "warning" ? " is-warning" : ""}`}>{baseUrlHelper.text}</small>
                  ) : null}
                </label>
                <label className="field-block">
                  <span className="field-label">{t("agents.models.fields.defaultModel")}</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("defaultModelKey", event.target.value)}
                    value={providerDraft.defaultModelKey}
                  >
                    {selectedProvider.modelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}{option.source === "api" ? "" : ` · ${t("agents.models.defaultSource")}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">{t("agents.models.fields.fallbackModel")}</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("fallbackModelKey", event.target.value)}
                    value={providerDraft.fallbackModelKey}
                  >
                    <option value="">{t("agents.models.noFallback")}</option>
                    {selectedProvider.modelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}{option.source === "api" ? "" : ` · ${t("agents.models.defaultSource")}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">{t("agents.models.fields.enabled")}</span>
                  <select
                    className="field-input"
                    disabled={!selectedProvider.supportsLiveRequests}
                    onChange={(event) => handleProviderFieldChange("enabled", event.target.value === "true")}
                    value={String(providerDraft.enabled)}
                  >
                    <option value="false">{t("agents.models.disabled")}</option>
                    <option value="true">{t("agents.models.enabled")}</option>
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">{t("agents.models.fields.timeout")}</span>
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
                  <span className="field-label">{t("agents.models.fields.retryCount")}</span>
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
                  <span className="agent-detail-kicker">{t("agents.models.lastError")}</span>
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
                  <span>{isSavingProvider ? t("common.saving") : t("common.save")}</span>
                </button>
                <button
                  className="ghost-control"
                  disabled={!selectedProvider.supportsLiveRequests || isTestingProvider}
                  onClick={handleTestProvider}
                  type="button"
                >
                  <RadioTower size={14} />
                  <span>{isTestingProvider ? t("agents.models.testing") : t("agents.models.testConnection")}</span>
                </button>
                <button
                  className="ghost-control"
                  disabled={!selectedProvider.supportsLiveRequests || isRefreshingModels || !selectedProvider.hasStoredSecret}
                  onClick={handleRefreshModels}
                  type="button"
                >
                  <RotateCcw size={14} />
                  <span>{isRefreshingModels ? t("agents.models.refreshing") : t("agents.models.refreshModels")}</span>
                </button>
                {selectedProvider.hasStoredSecret ? (
                  <button className="ghost-control" disabled={isSavingProvider} onClick={handleClearStoredKey} type="button">
                    <RotateCcw size={14} />
                    <span>{t("agents.models.clearStoredKey")}</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">{t("agents.models.selectServiceEmpty")}</div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard title={t("agents.models.assignments")}>
        <div className="models-assignment-list">
          {data.assignments.map((assignment) => {
            const draft = assignmentDrafts[assignment.agentId] ?? {
              providerKey: assignment.providerKey,
              modelKey: assignment.modelKey,
              modelLabel: assignment.modelLabel,
            };
            const draftProvider = data.providers.find((provider) => provider.providerKey === draft.providerKey);
            const assignmentReady = canAssignProvider(draftProvider);

            return (
              <div key={assignment.agentId} className="models-assignment-row">
                <div className="models-assignment-copy">
                  <strong>{assignment.displayName}</strong>
                  <p>{assignment.isSupervisor ? t("agents.models.supervisor") : assignment.providerLabel}</p>
                </div>

                <div className="models-assignment-controls">
                  <select
                    className="field-input"
                    onChange={(event) => handleAssignmentFieldChange(assignment.agentId, "providerKey", event.target.value)}
                    value={draft.providerKey}
                  >
                    {data.providers.map((provider) => (
                      <option
                        disabled={!canAssignProvider(provider)}
                        key={provider.providerKey}
                        value={provider.providerKey}
                      >
                        {provider.label}
                        {canAssignProvider(provider) ? "" : ` · ${providerStatusLabel(provider.status)}`}
                      </option>
                    ))}
                  </select>

                  <select
                    className="field-input"
                    disabled={!assignmentReady}
                    onChange={(event) => handleAssignmentFieldChange(assignment.agentId, "modelKey", event.target.value)}
                    value={draft.modelKey}
                  >
                    {(draftProvider?.modelOptions ?? []).map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    className="ghost-control"
                    disabled={assignmentBusyAgentId === assignment.agentId || !assignmentReady}
                    onClick={() => handleSaveAssignment(assignment)}
                    type="button"
                  >
                    <span>{assignmentBusyAgentId === assignment.agentId ? t("common.saving") : t("agents.models.assign")}</span>
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
