import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, KeyRound, Link2, RadioTower, RotateCcw, ShieldCheck } from "lucide-react";

import type { AgentConnectorRow, AppUsersSnapshot } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
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

const buildConnectorDraft = (connector: AgentConnectorRow | null): ConnectorDraft => ({
  enabled: connector?.status === "configured",
  botToken: "",
});

const getConnectorCapabilityLabel = (connectorKey: string) => {
  if (connectorKey === "telegram") {
    return "Direct messages";
  }

  if (connectorKey === "whatsapp") {
    return "Messaging";
  }

  if (connectorKey === "email") {
    return "Alerts and drafts";
  }

  return "Integrations";
};

const getConnectorStatusTone = (status: AgentConnectorRow["status"]) => {
  if (status === "configured") {
    return "success" as const;
  }

  if (status === "not_configured") {
    return "warning" as const;
  }

  return "neutral" as const;
};

const getConnectorStatusLabel = (status: AgentConnectorRow["status"]) => {
  if (status === "configured") {
    return "Ready";
  }

  if (status === "not_configured") {
    return "Needs setup";
  }

  return "Disabled";
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

export const AgentConnectorsPage = () => {
  const { activeWorkspaceId } = useWorkspace();
  const { data, error } = useAgentConnectors();
  const { data: catalog } = useCatalogData();
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [selectedConnectorKey, setSelectedConnectorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectorDraft>(buildConnectorDraft(null));
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);
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

  const summaryCards = useMemo(
    () => [
      { label: "Ready", value: data.filter((connector) => connector.status === "configured").length },
      {
        label: "Needs setup",
        value: data.filter((connector) => connector.status === "not_configured").length,
      },
      { label: "Disabled", value: data.filter((connector) => connector.status === "disabled").length },
      { label: "Active links", value: data.reduce((total, connector) => total + connector.activeLinks, 0) },
    ],
    [data],
  );

  const selectedConnector = useMemo(
    () => data.find((connector) => connector.connectorKey === selectedConnectorKey) ?? null,
    [data, selectedConnectorKey],
  );

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
        ? `${user.roleName ?? "No role"} · linked to crew ${user.linkedCrewLabel}`
        : `${user.roleName ?? "No role"} · internal user`,
      ready: user.readyForTelegram,
      source: "user",
      roleLabel: user.roleName,
      statusLabel: user.readyForTelegram
        ? user.telegramLinkStatus === "linked"
          ? "Ready · Telegram linked"
          : "Ready to link"
        : user.membershipStatus !== "active"
          ? "Blocked · account inactive"
          : !user.roleId
            ? "Blocked · assign a role"
            : !user.isActive
              ? "Blocked · user inactive"
              : "Needs setup",
      linkState: user.telegramLinkStatus === "linked" ? "linked" : user.readyForTelegram ? "ready" : user.telegramLinkStatus === "revoked" ? "revoked" : "blocked",
    }));

    const unlinkedCrew = (catalog.crewMembers ?? [])
      .filter((crewMember) => !crewMember.linkedUserId)
      .map<LinkableIdentityOption>((crewMember) => ({
        value: `unlinked:${crewMember.id}`,
        userId: null,
        label: `${crewMember.fullName}${crewMember.roleLabel ? ` · ${crewMember.roleLabel}` : ""}`,
        helper: "Crew without internal user yet",
        ready: false,
        source: "crew",
        roleLabel: crewMember.roleLabel ?? null,
        statusLabel: "Blocked · link a user first",
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
  }, [catalog.crewMembers, usersSnapshot.users]);

  const selectedIdentity = useMemo(
    () => linkableIdentities.find((option) => option.value === selectedUserId) ?? null,
    [linkableIdentities, selectedUserId],
  );

  const identitySummaryCards = useMemo(
    () => [
      { label: "Linked", value: linkableIdentities.filter((identity) => identity.linkState === "linked").length },
      { label: "Ready to link", value: linkableIdentities.filter((identity) => identity.linkState === "ready").length },
      { label: "Revoked", value: linkableIdentities.filter((identity) => identity.linkState === "revoked").length },
      { label: "Blocked", value: linkableIdentities.filter((identity) => identity.linkState === "blocked").length },
    ],
    [linkableIdentities],
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
    setFeedback(null);
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

    setIsSaving(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-save-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: draft.enabled,
        botToken: draft.botToken,
      });
      setFeedback(result.summary);
      setDraft((current) => ({
        ...current,
        botToken: "",
      }));
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, "Unable to save channel settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!selectedConnector) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-disable-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
      });
      setFeedback(result.summary);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, "Unable to disable this channel."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearSecret = async () => {
    if (!selectedConnector) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await saveConnectorConfig({
        commandId: `cmd-connector-clear-${Date.now().toString(36)}`,
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
        clearStoredSecret: true,
      });
      setFeedback(result.summary);
      setGeneratedLinkToken(null);
    } catch (saveError) {
      setErrorMessage(getUserFacingErrorMessage(saveError, "Unable to clear the stored token."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedConnector) {
      return;
    }

    setIsTesting(true);
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await testConnectorConnection({
        workspaceId: activeWorkspaceId,
        connectorKey: selectedConnector.connectorKey,
      });
      setFeedback(result.summary);
    } catch (testError) {
      setErrorMessage(getUserFacingErrorMessage(testError, "Unable to test this channel."));
    } finally {
      setIsTesting(false);
    }
  };

  const handleGenerateLinkToken = async () => {
    if (!selectedConnector || !selectedIdentity?.ready || !selectedIdentity.userId) {
      return;
    }

    setIsGeneratingToken(true);
    setFeedback(null);
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
      setFeedback(result.summary);
    } catch (tokenError) {
      setErrorMessage(getUserFacingErrorMessage(tokenError, "Unable to generate a link code."));
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
      setErrorMessage(getUserFacingErrorMessage(copyError, "Unable to copy the Telegram command."));
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="Channels" titleTone="accent" />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className="agents-models-layout">
        <SurfaceCard title="Available Channels">
          <div className="models-provider-list">
            {orderedConnectors.map((connector) => {
              const connectorBrand = getConnectorBrand(connector.connectorKey);

              return (
                <button
                  key={connector.id}
                  className={`models-provider-row${selectedConnectorKey === connector.connectorKey ? " is-selected" : ""}${
                    connector.status === "configured" ? " is-active-provider" : " is-inactive-provider"
                  }`}
                  onClick={() => setSelectedConnectorKey(connector.connectorKey)}
                  type="button"
                >
                  <span
                    aria-label={getConnectorStatusLabel(connector.status)}
                    className={`agent-live-dot agent-live-dot-${
                      connector.status === "configured" ? "green" : connector.status === "disabled" ? "red" : "amber"
                    }`}
                    data-tooltip={`${connector.label} · ${getConnectorStatusLabel(connector.status)}`}
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
                      <StatusBadge tone={getConnectorStatusTone(connector.status)}>
                        {getConnectorStatusLabel(connector.status)}
                      </StatusBadge>
                    </div>
                    <div className="agent-detail-row">
                      <span>{getConnectorCapabilityLabel(connector.connectorKey)}</span>
                      {connector.botUsername ? <span>@{connector.botUsername}</span> : null}
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
              "Channel"
            )
          }
        >
          {selectedConnector ? (
            <div className="agent-detail-stack">
              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Status</span>
                  <span className="summary-value">
                    <StatusBadge tone={getConnectorStatusTone(selectedConnector.status)}>
                      {getConnectorStatusLabel(selectedConnector.status)}
                    </StatusBadge>
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Channel</span>
                  <span className="summary-value">{getConnectorCapabilityLabel(selectedConnector.connectorKey)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Token stored</span>
                  <span className="summary-value">{selectedConnector.hasStoredSecret ? "Yes" : "No"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Bot username</span>
                  <span className="summary-value">{selectedConnector.botUsername ? `@${selectedConnector.botUsername}` : "Not verified"}</span>
                </div>
              </div>

              <div className="models-provider-health-grid">
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Last test</span>
                  <strong>{selectedConnector.lastTestedAtLabel}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Inbound</span>
                  <strong>{selectedConnector.inboundMessages}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Pending</span>
                  <strong>{selectedConnector.pendingDeliveries}</strong>
                </div>
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Last outbound</span>
                  <strong>{selectedConnector.lastOutboundAtLabel}</strong>
                </div>
              </div>

              <div className="agent-form-grid">
                <label className="field-block field-block-span-2">
                  <span className="field-label">Access token</span>
                  <input
                    className="field-input"
                    onChange={(event) => setDraft((current) => ({ ...current, botToken: event.target.value }))}
                    placeholder={selectedConnector.hasStoredSecret ? "Leave blank to keep the stored token" : "Paste the token"}
                    type="password"
                    value={draft.botToken}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Availability</span>
                  <select
                    className="field-input"
                    onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === "enabled" }))}
                    value={draft.enabled ? "enabled" : "disabled"}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
              </div>

              {selectedIdentity && !selectedIdentity.ready ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">Link blocked</span>
                  <p>
                    {selectedIdentity.source === "crew"
                      ? "This crew member still needs an internal user. Create it from Crew or link an existing user first."
                      : "This internal user is not ready for Telegram yet. Check active status, membership, and role."}
                  </p>
                </div>
              ) : null}

              {selectedConnector.lastErrorSummary ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">Last error</span>
                  <p>{selectedConnector.lastErrorSummary}</p>
                </div>
              ) : null}

              {selectedConnector.connectorKey === "telegram" ? (
                <details className="detail-disclosure">
                  <summary className="detail-disclosure-summary">People & linking</summary>
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
                        <span className="field-label">Internal user</span>
                        <select className="field-input" onChange={(event) => setSelectedUserId(event.target.value)} value={selectedUserId}>
                          {linkableIdentities.map((identity) => (
                            <option key={identity.value} value={identity.value}>
                              {identity.ready ? "" : "[Blocked] "}
                              {identity.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {selectedIdentity ? (
                      <div className="summary-grid">
                        <div className="summary-row">
                          <span className="summary-label">Selected user</span>
                          <span className="summary-value">{selectedIdentity.label}</span>
                        </div>
                        <div className="summary-row">
                          <span className="summary-label">Readiness</span>
                          <span className="summary-value">{selectedIdentity.statusLabel}</span>
                        </div>
                        {selectedIdentity.roleLabel ? (
                          <div className="summary-row">
                            <span className="summary-label">Role</span>
                            <span className="summary-value">{selectedIdentity.roleLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="connector-identity-directory">
                      <div className="surface-card-header">
                        <div>
                          <h3 className="surface-card-title">Telegram identities</h3>
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
                                {titleCaseEnum(identity.linkState)}
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
                <div className="summary-row">
                  <span className="summary-label">Availability</span>
                  <span className="summary-value">Visible now. Setup will appear here when this channel is ready.</span>
                </div>
              )}

              <div className="summary-row">
                <span className="summary-label">Summary</span>
                <span className="summary-value">{selectedConnector.deliverySummary}</span>
              </div>

              {generatedLinkToken ? (
                <div className="models-provider-feedback models-provider-feedback-success">
                  <div className="telegram-link-feedback-header">
                    <div className="agent-detail-row">
                      <strong>Link token ready</strong>
                      <code>{generatedLinkToken}</code>
                    </div>
                    <button
                      aria-label={copiedLinkCommand ? "Command copied" : "Copy Telegram command"}
                      className="icon-ghost-control telegram-link-copy-button"
                      data-tooltip={copiedLinkCommand ? "Copied" : "Copy command"}
                      onClick={() => void handleCopyLinkCommand()}
                      type="button"
                    >
                      {copiedLinkCommand ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="telegram-link-command-row">
                    <code className="telegram-link-command">/link {generatedLinkToken}</code>
                  </div>
                  <p>Copy this command and paste it into Telegram.</p>
                </div>
              ) : null}

              {feedback ? <div className="models-provider-feedback models-provider-feedback-success">{feedback}</div> : null}
              {errorMessage ? <div className="form-inline-error">{errorMessage}</div> : null}

              <div className="agent-detail-actions">
                <button className="primary-control" disabled={isSaving} onClick={() => void handleSave()} type="button">
                  <RadioTower size={16} />
                  <span>{isSaving ? "Saving..." : "Save"}</span>
                </button>
                <button
                  className="ghost-control"
                  disabled={isTesting || selectedConnector.connectorKey !== "telegram"}
                  onClick={() => void handleTest()}
                  type="button"
                >
                  <ShieldCheck size={16} />
                  <span>{isTesting ? "Testing..." : "Test connection"}</span>
                </button>
                <button
                  className="ghost-control"
                  disabled={
                    isGeneratingToken || !selectedUserId || !selectedIdentity?.ready || selectedConnector.connectorKey !== "telegram"
                  }
                  onClick={() => void handleGenerateLinkToken()}
                  type="button"
                >
                  <Link2 size={16} />
                  <span>{isGeneratingToken ? "Generating..." : "Generate link"}</span>
                </button>
                <button className="ghost-control" disabled={isSaving} onClick={() => void handleDisable()} type="button">
                  <RotateCcw size={16} />
                  <span>Disable</span>
                </button>
                {selectedConnector.hasStoredSecret ? (
                  <button className="ghost-control" disabled={isSaving} onClick={() => void handleClearSecret()} type="button">
                    <KeyRound size={16} />
                    <span>Clear token</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a channel to configure it.</div>
          )}
        </SurfaceCard>
      </div>

      {error ? <div className="empty-state">Channels unavailable: {error}</div> : null}
    </div>
  );
};
