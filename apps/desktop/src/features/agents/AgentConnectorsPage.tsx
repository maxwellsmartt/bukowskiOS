import { useEffect, useMemo, useState } from "react";
import { KeyRound, Link2, RadioTower, RotateCcw, ShieldCheck } from "lucide-react";

import { DEFAULT_WORKSPACE_ID, type AgentConnectorRow, type AppUsersSnapshot } from "@contracts";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getConnectorBrand } from "@shared/lib/connectorBranding";

import { useCatalogData } from "@features/projects/useProjectsData";

import {
  createConnectorLinkToken,
  saveConnectorConfig,
  testConnectorConnection,
  useAgentConnectors,
} from "./useAgentsData";

const workspaceId = DEFAULT_WORKSPACE_ID;

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

export const AgentConnectorsPage = () => {
  const { data, error } = useAgentConnectors();
  const { data: catalog } = useCatalogData();
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [selectedConnectorKey, setSelectedConnectorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectorDraft>(buildConnectorDraft(null));
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedLinkToken, setGeneratedLinkToken] = useState<string | null>(null);
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
        label: "Pending",
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

    void window.bukowskiApp.getUsersSnapshot().then(setUsersSnapshot).catch(() => {
      setUsersSnapshot(emptyUsersSnapshot);
    });
  }, []);

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
          : "Ready for Telegram"
        : user.membershipStatus !== "active"
          ? "Blocked · workspace inactive"
          : !user.roleId
            ? "Blocked · no role"
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
        statusLabel: "Blocked · create or link a user first",
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
    setFeedback(null);
    setErrorMessage(null);
  }, [selectedConnectorKey]);

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
        workspaceId,
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
      setErrorMessage(saveError instanceof Error ? saveError.message : "No se pudo guardar la configuración del connector.");
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
        workspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
      });
      setFeedback(result.summary);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "No se pudo desactivar el connector.");
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
        workspaceId,
        connectorKey: selectedConnector.connectorKey,
        enabled: false,
        clearStoredSecret: true,
      });
      setFeedback(result.summary);
      setGeneratedLinkToken(null);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "No se pudo borrar el secret almacenado.");
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
        workspaceId,
        connectorKey: selectedConnector.connectorKey,
      });
      setFeedback(result.summary);
    } catch (testError) {
      setErrorMessage(testError instanceof Error ? testError.message : "No se pudo probar la conexión con Telegram.");
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
        workspaceId,
        connectorKey: selectedConnector.connectorKey,
        userId: selectedIdentity.userId,
        expiresInMinutes: 30,
      });
      setGeneratedLinkToken(result.linkToken ?? null);
      setFeedback(result.summary);
    } catch (tokenError) {
      setErrorMessage(tokenError instanceof Error ? tokenError.message : "No se pudo generar el token de vinculación.");
    } finally {
      setIsGeneratingToken(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Connectors"
        titleTone="accent"
        body="Connect channels, verify status, and generate access links."
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
        <SurfaceCard title="Connectors" subtitle="Choose a channel to configure.">
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
                    aria-label={connector.status}
                    className={`agent-live-dot agent-live-dot-${
                      connector.status === "configured" ? "green" : connector.status === "disabled" ? "red" : "amber"
                    }`}
                    data-tooltip={`${connector.label} · ${connector.status.replace(/_/g, " ")}`}
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
                      <span className="subtle-pill">{connector.operationalMode === "dm_first" ? "DM" : "Future"}</span>
                    </div>
                    <div className="agent-detail-row">
                      <span>{connector.connectorKey === "telegram" ? "DM and linking" : connector.connectorKey === "whatsapp" ? "Messaging" : connector.connectorKey === "email" ? "Alerts and drafts" : "Integrations"}</span>
                      <span>{connector.botUsername ? `@${connector.botUsername}` : "Not verified"}</span>
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
              "Connector"
            )
          }
          subtitle={
            selectedConnector?.connectorKey === "telegram"
              ? "Save the bot, test the connection, and generate the link."
              : selectedConnector?.connectorKey === "whatsapp"
                ? "Visible for now. Activation comes later."
                : selectedConnector?.connectorKey === "email"
                  ? "Review status and readiness."
                  : "Reserve this channel for future integrations."
          }
        >
          {selectedConnector ? (
            <div className="agent-detail-stack">
              <div className="agent-detail-row">
                <span className={`run-status-pill run-status-pill-${selectedConnector.status}`}>
                  {selectedConnector.status.replace(/_/g, " ")}
                </span>
                {selectedConnector.hasStoredSecret ? <span className="subtle-pill">Stored secret</span> : <span className="subtle-pill">No secret</span>}
              </div>

              <div className="models-provider-health-grid">
                <div className="models-provider-health-card">
                  <span className="agent-detail-kicker">Bot username</span>
                  <strong>{selectedConnector.botUsername ? `@${selectedConnector.botUsername}` : "Not verified"}</strong>
                </div>
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
              </div>

              {selectedConnector.connectorKey === "telegram" ? (
                <div className="models-provider-health-grid">
                  {identitySummaryCards.map((card) => (
                    <div key={card.label} className="models-provider-health-card">
                      <span className="agent-detail-kicker">{card.label}</span>
                      <strong>{card.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="agent-form-grid">
                <label className="field-block field-block-span-2">
                  <span className="field-label">Bot token</span>
                  <input
                    className="field-input"
                    onChange={(event) => setDraft((current) => ({ ...current, botToken: event.target.value }))}
                    placeholder={selectedConnector.hasStoredSecret ? "Leave empty to keep the stored token" : "Paste the bot token here"}
                    type="password"
                    value={draft.botToken}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Mode</span>
                  <select
                    className="field-input"
                    onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === "enabled" }))}
                    value={draft.enabled ? "enabled" : "disabled"}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
                <label className="field-block">
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

              {selectedIdentity ? (
                <div className="agent-detail-row">
                  <span className="agent-detail-key">Selected identity</span>
                  <span>{selectedIdentity.helper}</span>
                </div>
              ) : null}

              {selectedIdentity ? (
                <div className="agent-detail-row">
                  <span className="agent-detail-key">State</span>
                  <span>{selectedIdentity.statusLabel}</span>
                </div>
              ) : null}

              {selectedIdentity?.roleLabel ? (
                <div className="agent-detail-row">
                  <span className="agent-detail-key">Role</span>
                  <span>{selectedIdentity.roleLabel}</span>
                </div>
              ) : null}

              {selectedIdentity?.userId ? (
                <div className="agent-detail-row">
                  <span className="agent-detail-key">Resolved internal user</span>
                  <span>{selectedIdentity.userId}</span>
                </div>
              ) : null}

              {selectedConnector.lastErrorSummary ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">Last error</span>
                  <p>{selectedConnector.lastErrorSummary}</p>
                </div>
              ) : null}

              {selectedConnector.connectorKey === "telegram" ? (
                <div className="connector-identity-directory">
                  <div className="surface-card-header">
                    <div>
                      <h3 className="surface-card-title">Telegram identities</h3>
                      <p className="surface-card-subtitle">
                        Pick from real internal users first. Crew without an internal user stays visible only as a blocked reference.
                      </p>
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
                          <span className={`run-status-pill run-status-pill-${
                            identity.linkState === "linked"
                              ? "configured"
                              : identity.linkState === "ready"
                                ? "queued"
                                : identity.linkState === "revoked"
                                  ? "disabled"
                                  : "blocked"
                          }`}
                          >
                            {identity.linkState}
                          </span>
                        </div>
                        <span>{identity.helper}</span>
                        <span>{identity.statusLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="agent-detail-row">
                <span className="agent-detail-key">Summary</span>
                <span>{selectedConnector.deliverySummary}</span>
              </div>
              <div className="agent-detail-row">
                <span className="agent-detail-key">Last inbound</span>
                <span>{selectedConnector.lastInboundAtLabel}</span>
              </div>
              <div className="agent-detail-row">
                <span className="agent-detail-key">Last outbound</span>
                <span>{selectedConnector.lastOutboundAtLabel}</span>
              </div>

              {generatedLinkToken ? (
                <div className="models-provider-feedback models-provider-feedback-success">
                  <div className="agent-detail-row">
                    <strong>Link token ready</strong>
                    <code>{generatedLinkToken}</code>
                  </div>
                  <p>Open the bot in Telegram DM and send: <code>/link {generatedLinkToken}</code></p>
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
                    <span>Clear stored secret</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a channel to configure it.</div>
          )}
        </SurfaceCard>
      </div>

      {error ? <div className="empty-state">Connectors unavailable: {error}</div> : null}
    </div>
  );
};
