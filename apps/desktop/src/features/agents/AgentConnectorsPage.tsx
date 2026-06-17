import { useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { Check, Copy, KeyRound, Link2, RadioTower, RotateCcw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentConnectorRow, AppUsersSnapshot } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { titleCaseEnum } from "@shared/labels/statusLabels";
import { getConnectorBrand } from "@shared/lib/connectorBranding";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { useCatalogData } from "@features/projects/useProjectsData";

import {
  createConnectorLinkToken,
  saveConnectorConfig,
  testConnectorConnection,
  useAgentConnectors,
} from "./useAgentsData";

const emptyUsersSnapshot: AppUsersSnapshot = {
  users: [],
  roles: [],
};

type ConnectorDraft = {
  enabled: boolean;
  botToken: string;
};

type LinkableIdentityOption = {
  value: string;
  userId: string | null;
  label: string;
  helper: string;
  ready: boolean;
  source: "user" | "crew";
  roleLabel: string | null;
  statusLabel: string;
  linkState: "linked" | "ready" | "revoked" | "blocked";
};

type ConnectorLifecycle = "live" | "staged" | "planned";

const buildConnectorDraft = (connector: AgentConnectorRow | null): ConnectorDraft => ({
  enabled: connector?.status === "configured",
  botToken: "",
});

const getConnectorLifecycle = (connectorKey: string): ConnectorLifecycle => {
  if (connectorKey === "telegram") {
    return "live";
  }

  if (connectorKey === "whatsapp" || connectorKey === "email") {
    return "staged";
  }

  return "planned";
};

const getConnectorCapabilityLabel = (connectorKey: string, t: TFunction) => {
  if (connectorKey === "telegram") {
    return t("agents.connectors.capabilities.telegram");
  }

  if (connectorKey === "whatsapp") {
    return t("agents.connectors.capabilities.whatsapp");
  }

  if (connectorKey === "email") {
    return t("agents.connectors.capabilities.email");
  }

  return t("agents.connectors.capabilities.default");
};

const getConnectorStatusTone = (status: AgentConnectorRow["status"], lifecycle: ConnectorLifecycle) => {
  if (status === "configured" && lifecycle === "live") {
    return "success" as const;
  }

  if (status === "configured") {
    return "warning" as const;
  }

  if (status === "not_configured") {
    return "critical" as const;
  }

  return "neutral" as const;
};

const getConnectorStatusLabel = (
  status: AgentConnectorRow["status"],
  lifecycle: ConnectorLifecycle,
  t: TFunction,
) => {
  if (status === "configured" && lifecycle === "live") {
    return t("agents.connectors.status.live", { defaultValue: "Live" });
  }

  if (status === "configured") {
    return t("agents.connectors.status.staged", { defaultValue: "Preparado" });
  }

  if (status === "not_configured") {
    return lifecycle === "planned"
      ? t("agents.connectors.status.planned", { defaultValue: "Planificado" })
      : t("agents.connectors.status.blocked", { defaultValue: "Bloqueado" });
  }

  return t("agents.connectors.status.paused", { defaultValue: "Paused" });
};

const getIdentityTone = (state: LinkableIdentityOption["linkState"]) => {
  if (state === "linked") {
    return "success" as const;
  }

  if (state === "ready") {
    return "info" as const;
  }

  if (state === "revoked") {
    return "warning" as const;
  }

  return "critical" as const;
};

const getConnectorLifecycleLabel = (lifecycle: ConnectorLifecycle, t: TFunction) =>
  t(`agents.connectors.lifecycle.${lifecycle}.label`);

const getConnectorLifecycleTitle = (lifecycle: ConnectorLifecycle, t: TFunction) =>
  t(`agents.connectors.lifecycle.${lifecycle}.title`);

const getConnectorLifecycleBody = (lifecycle: ConnectorLifecycle, t: TFunction) =>
  t(`agents.connectors.lifecycle.${lifecycle}.body`);

const getConnectorStateHint = (
  status: AgentConnectorRow["status"],
  lifecycle: ConnectorLifecycle,
  t: TFunction,
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

  if (lifecycle === "planned") {
    return t("agents.connectors.hints.plannedBlocked", { defaultValue: "Bloqueado hasta que este canal se habilite" });
  }

  return t("agents.connectors.hints.blocked", { defaultValue: "Bloqueado hasta conectar credenciales y entrega real" });
};

export const AgentConnectorsPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const { data, error } = useAgentConnectors({ workspaceId: activeWorkspaceId });
  const { data: catalog } = useCatalogData();
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [selectedConnectorKey, setSelectedConnectorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectorDraft>(buildConnectorDraft(null));
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedLinkToken, setGeneratedLinkToken] = useState<string | null>(null);
  const [copiedLinkCommand, setCopiedLinkCommand] = useState(false);
  const copiedLinkCommandTimeoutRef = useRef<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);

  const orderedConnectors = useMemo(() => {
    const connectorOrder = new Map([
      ["telegram", 0],
      ["whatsapp", 1],
      ["email", 2],
      ["webhook", 3],
    ]);

    return [...data].sort((left, right) => {
      const leftOrder = connectorOrder.get(left.connectorKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = connectorOrder.get(right.connectorKey) ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.label.localeCompare(right.label);
    });
  }, [data]);

  const selectedConnector = useMemo(
    () => data.find((connector) => connector.connectorKey === selectedConnectorKey) ?? null,
    [data, selectedConnectorKey],
  );
  const selectedConnectorIsLive = selectedConnector?.connectorKey === "telegram";
  const selectedConnectorLifecycle = selectedConnector ? getConnectorLifecycle(selectedConnector.connectorKey) : null;

  useEffect(() => {
    if (!window.bukowskiApp) {
      return;
    }

    void window.bukowskiApp.getUsersSnapshot({ workspaceId: activeWorkspaceId }).then(setUsersSnapshot).catch(() => {
      setUsersSnapshot(emptyUsersSnapshot);
    });
  }, [activeWorkspaceId]);

  const linkableIdentities = useMemo(() => {
    const readyUsers = usersSnapshot.users.map<LinkableIdentityOption>((user) => ({
      value: `user:${user.id}`,
      userId: user.id,
      label: user.fullName,
      helper: user.linkedCrewLabel
        ? t("agents.connectors.identity.linkedCrew", { role: user.roleName ?? t("agents.connectors.identity.noRole"), crew: user.linkedCrewLabel })
        : t("agents.connectors.identity.internalUser", { role: user.roleName ?? t("agents.connectors.identity.noRole") }),
      ready: user.readyForTelegram,
      source: "user",
      roleLabel: user.roleName,
      statusLabel: user.readyForTelegram
        ? user.telegramLinkStatus === "linked"
          ? t("agents.connectors.identity.readyLinked")
          : t("agents.connectors.identity.readyToLink")
        : user.membershipStatus !== "active"
          ? t("agents.connectors.identity.blockedInactiveAccount")
          : !user.roleId
            ? t("agents.connectors.identity.blockedRole")
            : !user.isActive
              ? t("agents.connectors.identity.blockedInactiveUser")
              : t("agents.connectors.status.needs_setup"),
      linkState: user.telegramLinkStatus === "linked" ? "linked" : user.readyForTelegram ? "ready" : user.telegramLinkStatus === "revoked" ? "revoked" : "blocked",
    }));

    const unlinkedCrew = (catalog.crewMembers ?? [])
      .filter((crewMember) => !crewMember.linkedUserId)
      .map<LinkableIdentityOption>((crewMember) => ({
        value: `unlinked:${crewMember.id}`,
        userId: null,
        label: `${crewMember.fullName}${crewMember.roleLabel ? ` · ${crewMember.roleLabel}` : ""}`,
        helper: t("agents.connectors.identity.crewWithoutUser"),
        ready: false,
        source: "crew",
        roleLabel: crewMember.roleLabel ?? null,
        statusLabel: t("agents.connectors.identity.blockedLinkUser"),
        linkState: "blocked",
      }));

    return [...readyUsers, ...unlinkedCrew].sort((left, right) => {
      const stateOrder = new Map([
        ["ready", 0],
        ["linked", 1],
        ["revoked", 2],
        ["blocked", 3],
      ]);

      const leftState = stateOrder.get(left.linkState) ?? Number.MAX_SAFE_INTEGER;
      const rightState = stateOrder.get(right.linkState) ?? Number.MAX_SAFE_INTEGER;

      if (leftState !== rightState) {
        return leftState - rightState;
      }

      if (left.ready !== right.ready) {
        return left.ready ? -1 : 1;
      }

      if (left.source !== right.source) {
        return left.source === "user" ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
  }, [catalog.crewMembers, t, usersSnapshot.users]);

  const selectedIdentity = useMemo(
    () => linkableIdentities.find((option) => option.value === selectedUserId) ?? null,
    [linkableIdentities, selectedUserId],
  );

  const identitySummaryCards = useMemo(
    () => [
      { label: t("agents.connectors.identity.summary.linked"), value: linkableIdentities.filter((identity) => identity.linkState === "linked").length },
      { label: t("agents.connectors.identity.summary.ready"), value: linkableIdentities.filter((identity) => identity.linkState === "ready").length },
      { label: t("agents.connectors.identity.summary.revoked"), value: linkableIdentities.filter((identity) => identity.linkState === "revoked").length },
      { label: t("agents.connectors.identity.summary.blocked"), value: linkableIdentities.filter((identity) => identity.linkState === "blocked").length },
    ],
    [linkableIdentities, t],
  );

  useEffect(() => {
    if (!orderedConnectors.length) {
      if (selectedConnectorKey) {
        setSelectedConnectorKey(null);
      }
      return;
    }

    const hasSelectedConnector = orderedConnectors.some((connector) => connector.connectorKey === selectedConnectorKey);

    if (!selectedConnectorKey || !hasSelectedConnector) {
      setSelectedConnectorKey(
        orderedConnectors.find((connector) => connector.connectorKey === "telegram")?.connectorKey ??
          orderedConnectors[0]?.connectorKey ??
          null,
      );
    }
  }, [orderedConnectors, selectedConnectorKey]);

  useEffect(() => {
    setDraft(buildConnectorDraft(selectedConnector));
  }, [selectedConnector]);

  useEffect(() => {
    setGeneratedLinkToken(null);
    setCopiedLinkCommand(false);
    setErrorMessage(null);
  }, [selectedConnectorKey]);

  useEffect(
    () => () => {
      if (copiedLinkCommandTimeoutRef.current !== null) {
        window.clearTimeout(copiedLinkCommandTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!linkableIdentities.length) {
      if (selectedUserId) {
        setSelectedUserId("");
      }
      return;
    }

    const hasSelectedIdentity = linkableIdentities.some((option) => option.value === selectedUserId);

    if (!selectedUserId || !hasSelectedIdentity) {
      setSelectedUserId(
        linkableIdentities.find((option) => option.linkState === "ready")?.value ??
          linkableIdentities.find((option) => option.linkState === "linked")?.value ??
          linkableIdentities[0]?.value ??
          "",
      );
    }
  }, [linkableIdentities, selectedUserId]);

  const handleSave = async () => {
    if (!selectedConnector) {
      return;
    }
    if (!selectedConnectorIsLive) {
      setErrorMessage(t("agents.connectors.setupFuture"));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-save-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: draft.enabled,
        botToken: draft.botToken,
      });
      toast.success(t("agents.connectors.toasts.saved"), result.summary);
      setDraft((current) => ({
        ...current,
        botToken: "",
      }));
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, t("agents.connectors.errors.save")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!selectedConnector) {
      return;
    }
    if (!selectedConnectorIsLive) {
      setErrorMessage(t("agents.connectors.setupFuture"));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-disable-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
      });
      toast.success(t("agents.connectors.toasts.disabled"), result.summary);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, t("agents.connectors.errors.disable")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearSecret = async () => {
    if (!selectedConnector) {
      return;
    }
    if (!selectedConnectorIsLive) {
      setErrorMessage(t("agents.connectors.setupFuture"));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-clear-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
        clearStoredSecret: true,
      });
      toast.success(t("agents.connectors.toasts.tokenCleared"), result.summary);
      setGeneratedLinkToken(null);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, t("agents.connectors.errors.clearToken")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedConnector) {
      return;
    }
    if (!selectedConnectorIsLive) {
      setErrorMessage(t("agents.connectors.setupFuture"));
      return;
    }

    setIsTesting(true);
    setErrorMessage(null);

    try {
      const result = await testConnectorConnection({
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
      });
      toast.success(t("agents.connectors.toasts.tested"), result.summary);
    } catch (testError) {
      setErrorMessage(getUserFacingErrorMessage(testError, t("agents.connectors.errors.test")));
    } finally {
      setIsTesting(false);
    }
  };

  const handleGenerateLinkToken = async () => {
    if (!selectedConnector || !selectedConnectorIsLive || !selectedIdentity?.ready || !selectedIdentity.userId) {
      return;
    }

    setIsGeneratingToken(true);
    setErrorMessage(null);

    try {
      const result = await createConnectorLinkToken({
        commandId: `cmd-connector-link-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        userId: selectedIdentity.userId,
        expiresInMinutes: 30,
      });
      setGeneratedLinkToken(result.linkToken ?? null);
      setCopiedLinkCommand(false);
      toast.success(t("agents.connectors.toasts.linkReady"), result.summary);
    } catch (tokenError) {
      setErrorMessage(getUserFacingErrorMessage(tokenError, t("agents.connectors.errors.linkCode")));
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleCopyLinkCommand = async () => {
    if (!generatedLinkToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(`/link ${generatedLinkToken}`);
      setCopiedLinkCommand(true);
      if (copiedLinkCommandTimeoutRef.current !== null) {
        window.clearTimeout(copiedLinkCommandTimeoutRef.current);
      }
      copiedLinkCommandTimeoutRef.current = window.setTimeout(() => {
        setCopiedLinkCommand(false);
        copiedLinkCommandTimeoutRef.current = null;
      }, 2200);
    } catch (copyError) {
      setErrorMessage(getUserFacingErrorMessage(copyError, t("agents.connectors.errors.copyCommand")));
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("agents.connectors.title")} titleTone="accent" />

      <div className="agents-models-layout">
        <SurfaceCard
          title={t("agents.connectors.availableChannels")}
          subtitle={t("agents.connectors.availableChannelsSubtitle", { count: orderedConnectors.length })}
        >
          <div className="models-provider-list">
            {orderedConnectors.map((connector) => {
              const connectorBrand = getConnectorBrand(connector.connectorKey);
              const connectorLifecycle = getConnectorLifecycle(connector.connectorKey);

              return (
                <button
                  key={connector.id}
                  className={`models-provider-row models-provider-row-${connectorLifecycle}${
                    selectedConnectorKey === connector.connectorKey ? " is-selected" : ""
                  }${connector.status === "configured" ? " is-configured-provider" : ""}${
                    connector.status === "disabled" ? " is-disabled-provider" : ""
                  }`}
                  onClick={() => setSelectedConnectorKey(connector.connectorKey)}
                  type="button"
                >
                    <span
                    aria-label={getConnectorStatusLabel(connector.status, connectorLifecycle, t)}
                    className={`agent-live-dot agent-live-dot-${
                      connector.status === "configured" ? "green" : connector.status === "disabled" ? "red" : "amber"
                    }`}
                    data-tooltip={`${connector.label} · ${getConnectorStatusLabel(connector.status, connectorLifecycle, t)}`}
                  />
                  <div className="models-provider-row-copy">
                    <div className="models-provider-row-topline">
                      <strong className="provider-heading">
                        {connectorBrand.logoSrc ? (
                          <img
                            alt={connectorBrand.logoAlt ?? connector.label}
                            className={`provider-heading-logo${connectorBrand.logoClassName ? ` ${connectorBrand.logoClassName}` : ""}`}
                            src={connectorBrand.logoSrc}
                          />
                        ) : null}
                          <span>{connector.label}</span>
                        </strong>
                      <span className={`channel-lifecycle-pill channel-lifecycle-pill-${connectorLifecycle}`}>
                        {getConnectorLifecycleLabel(connectorLifecycle, t)}
                      </span>
                    </div>
                    <div className="agent-detail-row">
                      <span>{getConnectorCapabilityLabel(connector.connectorKey, t)}</span>
                      <span>{getConnectorStateHint(connector.status, connectorLifecycle, t)}</span>
                    </div>
                    <div className="agent-detail-row">
                      <StatusBadge tone={getConnectorStatusTone(connector.status, connectorLifecycle)}>
                        {getConnectorStatusLabel(connector.status, connectorLifecycle, t)}
                      </StatusBadge>
                      {connectorLifecycle === "live" && connector.botUsername ? <span>@{connector.botUsername}</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard
          title={
            selectedConnector ? (
              <span className="provider-heading">
                {getConnectorBrand(selectedConnector.connectorKey).logoSrc ? (
                  <img
                    alt={getConnectorBrand(selectedConnector.connectorKey).logoAlt ?? selectedConnector.label}
                    className={`provider-heading-logo${
                      getConnectorBrand(selectedConnector.connectorKey).logoClassName
                        ? ` ${getConnectorBrand(selectedConnector.connectorKey).logoClassName}`
                        : ""
                    }`}
                    src={getConnectorBrand(selectedConnector.connectorKey).logoSrc ?? ""}
                  />
                ) : null}
                <span>{selectedConnector.label}</span>
              </span>
            ) : (
              t("agents.connectors.channelFallback")
            )
          }
          subtitle={
            selectedConnector && selectedConnectorLifecycle
              ? getConnectorLifecycleBody(selectedConnectorLifecycle, t)
              : undefined
          }
        >
          {selectedConnector ? (
            <div className="agent-detail-stack">
              <div className={`connector-stage-banner connector-stage-banner-${selectedConnectorLifecycle ?? "planned"}`}>
                <div className="connector-stage-banner-copy">
                  <span className="agent-detail-kicker">
                    {selectedConnectorLifecycle ? getConnectorLifecycleTitle(selectedConnectorLifecycle, t) : t("agents.connectors.channelFallback")}
                  </span>
                  <strong>{selectedConnector.deliverySummary}</strong>
                </div>
                <div className="connector-stage-banner-meta">
                  <StatusBadge tone={getConnectorStatusTone(selectedConnector.status, selectedConnectorLifecycle ?? "planned")}>
                    {getConnectorStatusLabel(selectedConnector.status, selectedConnectorLifecycle ?? "planned", t)}
                  </StatusBadge>
                  <span className={`channel-lifecycle-pill channel-lifecycle-pill-${selectedConnectorLifecycle ?? "planned"}`}>
                    {selectedConnectorLifecycle ? getConnectorLifecycleLabel(selectedConnectorLifecycle, t) : t("agents.connectors.lifecycle.planned.label")}
                  </span>
                  {selectedConnector.connectorKey === "telegram" && selectedConnector.botUsername ? (
                    <span className="subtle-pill">@{selectedConnector.botUsername}</span>
                  ) : null}
                  <span className="subtle-pill">
                    {t("agents.connectors.fields.tokenStored")}:{" "}
                    {selectedConnector.hasStoredSecret ? t("common.yes", { defaultValue: "Yes" }) : t("common.no", { defaultValue: "No" })}
                  </span>
                </div>
              </div>

              {selectedConnectorIsLive ? (
                <>
                  <div className="models-provider-health-grid">
                    <div className="models-provider-health-card">
                      <span className="agent-detail-kicker">{t("agents.connectors.fields.lastTest")}</span>
                      <strong>{selectedConnector.lastTestedAtLabel}</strong>
                    </div>
                    <div className="models-provider-health-card">
                      <span className="agent-detail-kicker">{t("agents.connectors.fields.inbound")}</span>
                      <strong>{selectedConnector.inboundMessages}</strong>
                    </div>
                    <div className="models-provider-health-card">
                      <span className="agent-detail-kicker">{t("agents.connectors.fields.pending")}</span>
                      <strong>{selectedConnector.pendingDeliveries}</strong>
                    </div>
                    <div className="models-provider-health-card">
                      <span className="agent-detail-kicker">{t("agents.connectors.fields.lastOutbound")}</span>
                      <strong>{selectedConnector.lastOutboundAtLabel}</strong>
                    </div>
                  </div>

                  <div className="agent-form-grid">
                    <label className="field-block field-block-span-2">
                      <span className="field-label">{t("agents.connectors.fields.accessToken")}</span>
                      <input
                        className="field-input"
                        onChange={(event) => setDraft((current) => ({ ...current, botToken: event.target.value }))}
                        placeholder={selectedConnector.hasStoredSecret ? t("agents.connectors.placeholders.keepToken") : t("agents.connectors.placeholders.pasteToken")}
                        type="password"
                        value={draft.botToken}
                      />
                    </label>
                    <label className="field-block">
                      <span className="field-label">{t("agents.connectors.fields.availability")}</span>
                      <select
                        className="field-input"
                        onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === "enabled" }))}
                        value={draft.enabled ? "enabled" : "disabled"}
                      >
                        <option value="enabled">{t("agents.connectors.availability.enabled")}</option>
                        <option value="disabled">{t("agents.connectors.availability.disabled")}</option>
                      </select>
                    </label>
                  </div>
                </>
              ) : null}

              {selectedConnectorIsLive && selectedIdentity && !selectedIdentity.ready ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">{t("agents.connectors.linkBlocked")}</span>
                  <p>
                    {selectedIdentity.source === "crew"
                      ? t("agents.connectors.linkBlockedCrew")
                      : t("agents.connectors.linkBlockedUser")}
                  </p>
                </div>
              ) : null}

              {selectedConnectorIsLive && selectedConnector.lastErrorSummary ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">{t("agents.connectors.lastError")}</span>
                  <p>{selectedConnector.lastErrorSummary}</p>
                </div>
              ) : null}

              {selectedConnector.connectorKey !== "telegram" ? (
                <ChannelProviderShellPreview connectorKey={selectedConnector.connectorKey} />
              ) : null}

              {selectedConnectorIsLive ? (
                <details className="detail-disclosure">
                  <summary className="detail-disclosure-summary">{t("agents.connectors.linkUserToTelegram")}</summary>
                  <div className="detail-disclosure-content">
                    <div className="models-provider-health-grid">
                      {identitySummaryCards.map((card) => (
                        <div key={card.label} className="models-provider-health-card">
                          <span className="agent-detail-kicker">{card.label}</span>
                          <strong>{card.value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="agent-form-grid">
                      <label className="field-block field-block-span-2">
                        <span className="field-label">{t("agents.connectors.fields.internalUser")}</span>
                        <select className="field-input" onChange={(event) => setSelectedUserId(event.target.value)} value={selectedUserId}>
                          {linkableIdentities.map((identity) => (
                            <option key={identity.value} value={identity.value}>
                              {identity.ready ? "" : `${t("agents.connectors.identity.blockedPrefix")} `}
                              {identity.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {selectedIdentity ? (
                      <div className="summary-grid">
                        <div className="summary-row">
                          <span className="summary-label">{t("agents.connectors.fields.selectedUser")}</span>
                          <span className="summary-value">{selectedIdentity.label}</span>
                        </div>
                        <div className="summary-row">
                          <span className="summary-label">{t("agents.connectors.fields.readiness")}</span>
                          <span className="summary-value">{selectedIdentity.statusLabel}</span>
                        </div>
                        {selectedIdentity.roleLabel ? (
                          <div className="summary-row">
                            <span className="summary-label">{t("agents.connectors.fields.role")}</span>
                            <span className="summary-value">{selectedIdentity.roleLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="connector-identity-directory">
                      <div className="surface-card-header">
                        <div>
                          <h3 className="surface-card-title">{t("agents.connectors.telegramIdentities")}</h3>
                        </div>
                      </div>
                      <div className="connector-identity-list">
                        {linkableIdentities.map((identity) => (
                          <button
                            key={identity.value}
                            className={`connector-identity-row${selectedUserId === identity.value ? " is-selected" : ""}`}
                            onClick={() => setSelectedUserId(identity.value)}
                            type="button"
                          >
                            <div className="connector-identity-topline">
                              <strong>{identity.label}</strong>
                              <StatusBadge tone={getIdentityTone(identity.linkState)}>
                                {t(`agents.connectors.identity.state.${identity.linkState}`, { defaultValue: titleCaseEnum(identity.linkState) })}
                              </StatusBadge>
                            </div>
                            <span>{identity.helper}</span>
                            <span>{identity.statusLabel}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              ) : (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">{t("agents.connectors.fields.availability")}</span>
                  <p>{t("agents.connectors.setupFuture")}</p>
                </div>
              )}

              {selectedConnectorIsLive && generatedLinkToken ? (
                <div className="models-provider-feedback models-provider-feedback-success">
                  <div className="telegram-link-feedback-header">
                    <div className="agent-detail-row">
                      <strong>{t("agents.connectors.linkTokenReady")}</strong>
                      <code>{generatedLinkToken}</code>
                    </div>
                    <button
                      aria-label={copiedLinkCommand ? t("agents.connectors.commandCopied") : t("agents.connectors.copyTelegramCommand")}
                      className="icon-ghost-control telegram-link-copy-button"
                      data-tooltip={copiedLinkCommand ? t("common.copied") : t("agents.connectors.copyCommand")}
                      onClick={() => void handleCopyLinkCommand()}
                      type="button"
                    >
                      {copiedLinkCommand ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="telegram-link-command-row">
                    <code className="telegram-link-command">/link {generatedLinkToken}</code>
                  </div>
                  <p>{t("agents.connectors.copyCommandBody")}</p>
                </div>
              ) : null}

              {errorMessage ? <div className="form-inline-error">{errorMessage}</div> : null}

              {selectedConnectorIsLive ? (
                <div className="agent-detail-actions">
                  <button className="primary-control" disabled={isSaving} onClick={() => void handleSave()} type="button">
                    <RadioTower size={16} />
                    <span>{isSaving ? t("common.saving") : t("common.save")}</span>
                  </button>
                  <button
                    className="ghost-control"
                    disabled={isTesting}
                    onClick={() => void handleTest()}
                    type="button"
                  >
                    <ShieldCheck size={16} />
                    <span>{isTesting ? t("agents.connectors.testing") : t("agents.connectors.testConnection")}</span>
                  </button>
                  <button
                    className="ghost-control"
                    disabled={isGeneratingToken || !selectedUserId || !selectedIdentity?.ready}
                    onClick={() => void handleGenerateLinkToken()}
                    type="button"
                  >
                    <Link2 size={16} />
                    <span>{isGeneratingToken ? t("agents.connectors.generating") : t("agents.connectors.generateLink")}</span>
                  </button>
                  <button className="ghost-control" disabled={isSaving} onClick={() => void handleDisable()} type="button">
                    <RotateCcw size={16} />
                    <span>{t("agents.connectors.disable")}</span>
                  </button>
                  {selectedConnector.hasStoredSecret ? (
                    <button className="ghost-control" disabled={isSaving} onClick={() => void handleClearSecret()} type="button">
                      <KeyRound size={16} />
                      <span>{t("agents.connectors.clearToken")}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">{t("agents.connectors.selectChannel")}</div>
          )}
        </SurfaceCard>
      </div>

      {error ? <div className="empty-state">{t("agents.connectors.unavailable", { message: error })}</div> : null}
    </div>
  );
};

type ProviderShell = {
  key: "whatsapp" | "email" | "sms" | "webhook";
  label: string;
  shortDescription: string;
  expectedSecretLabel: string;
  expectedExtras: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
  linkInstructions: string;
  shipStatus: "staged-ui" | "planned";
};

const channelShells: Record<string, ProviderShell> = {
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp",
    shortDescription: "Inbound and outbound messaging through the WhatsApp Business Cloud API.",
    expectedSecretLabel: "Access token",
    expectedExtras: [
      { key: "businessPhoneNumberId", label: "Business phone number ID", placeholder: "123456789", required: true },
      { key: "verifyToken", label: "Webhook verify token", placeholder: "secret-string", required: true },
    ],
    linkInstructions:
      "Once wired, each teammate scans a QR or sends a single keyword to the business number to claim their seat.",
    shipStatus: "staged-ui",
  },
  email: {
    key: "email",
    label: "Email / Notifications",
    shortDescription: "Drafts, support outreach and internal notices via SMTP or a transactional provider.",
    expectedSecretLabel: "API key or SMTP password",
    expectedExtras: [
      { key: "fromAddress", label: "From address", placeholder: "ops@studio.com", required: true },
      { key: "smtpHost", label: "SMTP host (optional)", placeholder: "smtp.postmark.app", required: false },
    ],
    linkInstructions: "Email works automatically once a teammate has an email on their profile.",
    shipStatus: "staged-ui",
  },
  sms: {
    key: "sms",
    label: "SMS",
    shortDescription: "Operator alerts via Twilio or a compatible SMS gateway.",
    expectedSecretLabel: "Auth token",
    expectedExtras: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxx", required: true },
      { key: "fromNumber", label: "From number", placeholder: "+15551234567", required: true },
    ],
    linkInstructions: "Each teammate confirms with a one-time code we text to the phone on their profile.",
    shipStatus: "planned",
  },
  webhook: {
    key: "webhook",
    label: "Webhook / Future",
    shortDescription: "Fan-out delivery to custom HTTPS endpoints for future integrations.",
    expectedSecretLabel: "Signing secret",
    expectedExtras: [
      { key: "endpointUrl", label: "Endpoint URL", placeholder: "https://hooks.example.com/bukowski", required: true },
    ],
    linkInstructions: "Linking is per-endpoint configuration, not per-user.",
    shipStatus: "planned",
  },
};

const ChannelProviderShellPreview = ({ connectorKey }: { connectorKey: string }) => {
  const { t } = useTranslation();
  const shell = channelShells[connectorKey];
  if (!shell) {
    return null;
  }

  const isStagedUI = shell.shipStatus === "staged-ui";
  return (
    <div className="channel-shell-preview" style={{ marginBottom: 12 }}>
      <div className="channel-shell-eyebrow">
        <span className={`channel-shell-pill channel-shell-pill-${shell.shipStatus}`}>
          {isStagedUI ? t("agents.connectors.shells.stagedUi") : t("agents.connectors.shells.planned")}
        </span>
        <strong>{t(`agents.connectors.shells.${shell.key}.label`, { defaultValue: shell.label })}</strong>
      </div>
      <p className="channel-shell-body">{t(`agents.connectors.shells.${shell.key}.shortDescription`, { defaultValue: shell.shortDescription })}</p>

      <div className="channel-shell-section">
        <span className="agent-detail-kicker">{t("agents.connectors.shells.whenWired")}</span>
        <ul className="channel-shell-list">
          <li>
            <strong>{t(`agents.connectors.shells.${shell.key}.expectedSecretLabel`, { defaultValue: shell.expectedSecretLabel })}</strong>
            <small>{t("agents.connectors.shells.secretStorage")}</small>
          </li>
          {shell.expectedExtras.map((extra) => (
            <li key={extra.key}>
              <strong>
                {t(`agents.connectors.shells.${shell.key}.extras.${extra.key}.label`, { defaultValue: extra.label })}
                {extra.required ? "" : ` (${t("common.optional")})`}
              </strong>
              <small>{t(`agents.connectors.shells.${shell.key}.extras.${extra.key}.placeholder`, { defaultValue: extra.placeholder })}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className="channel-shell-section">
        <span className="agent-detail-kicker">{t("agents.connectors.shells.userLinkingFlow")}</span>
        <p className="channel-shell-body">{t(`agents.connectors.shells.${shell.key}.linkInstructions`, { defaultValue: shell.linkInstructions })}</p>
      </div>
    </div>
  );
};
