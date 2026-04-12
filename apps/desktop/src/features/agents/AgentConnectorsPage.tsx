import { useMemo } from "react";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useAgentConnectors } from "./useAgentsData";

export const AgentConnectorsPage = () => {
  const { data, error } = useAgentConnectors();
  const summaryCards = useMemo(
    () => [
      { label: "Configured", value: data.filter((connector) => connector.status === "configured").length },
      {
        label: "Not configured",
        value: data.filter((connector) => connector.status === "not_configured").length,
      },
      { label: "Disabled", value: data.filter((connector) => connector.status === "disabled").length },
    ],
    [data],
  );

  return (
    <div className="page-stack">
      <SectionHeader
        title="Connectors"
        titleTone="accent"
        body="Connector readiness stays visible from day one, even before real gateways turn on."
      />

      <div className="agents-health-grid">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="agents-health-card">
            <span className="agents-health-label">{card.label}</span>
            <strong className="agents-health-value">{card.value}</strong>
          </SurfaceCard>
        ))}
      </div>

      <div className="agents-support-grid">
        {data.map((connector) => (
          <SurfaceCard key={connector.id} title={connector.label} subtitle={connector.capability}>
            <div className="agent-detail-row">
              <span className={`run-status-pill run-status-pill-${connector.status}`}>{connector.status.replace(/_/g, " ")}</span>
            </div>
            <p className="agent-detail-notes">{connector.notes || "Configuration can be layered on later without changing this surface."}</p>
          </SurfaceCard>
        ))}
      </div>

      {error ? <div className="empty-state">Connectors unavailable: {error}</div> : null}
    </div>
  );
};
