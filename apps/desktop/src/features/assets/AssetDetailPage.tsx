import { useParams } from "react-router-dom";

import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { useAssetDetail } from "./useAssetsData";

export const AssetDetailPage = () => {
  const { assetId } = useParams();
  const { data } = useAssetDetail(assetId);

  if (!data.asset) {
    return <div className="empty-state">Asset not found in the local workspace.</div>;
  }

  return (
    <div className="page-stack">
      <SurfaceCard
        title={data.asset.name}
        subtitle="Current status, custody and recent history for this asset."
        aside={<StatusBadge tone={data.asset.status === "Maintenance" ? "warning" : "info"}>{data.asset.status}</StatusBadge>}
      >
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">Internal code</span>
            <span className="summary-value">{data.asset.code}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Current location</span>
            <span className="summary-value">{data.asset.location}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Project</span>
            <span className="summary-value">{data.asset.project}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Responsible</span>
            <span className="summary-value">{data.asset.responsible}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Condition</span>
            <span className="summary-value">{data.asset.condition}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Replacement</span>
            <span className="summary-value">{data.asset.replacementValue}</span>
          </div>
        </div>

        <div className="chip-row">
          <StatusBadge tone="info">Assign</StatusBadge>
          <StatusBadge tone="warning">Check in</StatusBadge>
          <StatusBadge tone="critical">Report issue</StatusBadge>
          <StatusBadge tone="success">Maintenance</StatusBadge>
        </div>
      </SurfaceCard>

      <div className="split-layout">
        <SurfaceCard title="Event timeline" subtitle="Trace of the operational events behind the current state.">
          <div className="timeline-list">
            {data.timeline.map((event) => (
              <div key={event.timestamp + event.title} className="timeline-item">
                <span className="timeline-time">{event.timestamp}</span>
                <strong>{event.title}</strong>
                <span>{event.body}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Linked incidents" subtitle="Open and recent issues related to this asset.">
          <div className="queue-list">
            {data.linkedIncidents.map((incident) => (
              <div key={incident.title} className="queue-item">
                <div className="identity-cell">
                  <span className="identity-title">{incident.title}</span>
                  <span className="identity-meta">
                    {incident.project} · {incident.costEstimate}
                  </span>
                </div>
                <StatusBadge tone={incident.severity === "High" ? "critical" : "warning"}>
                  {incident.severity}
                </StatusBadge>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
