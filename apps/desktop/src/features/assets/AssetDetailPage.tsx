import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { assetTimeline, assets, incidents } from "@shared/lib/sample-data";

const asset = assets[0];

export const AssetDetailPage = () => (
  <div className="page-stack">
    <SurfaceCard
      title={asset.name}
      subtitle="Identity, current state and quick actions stay above the fold. History remains easy to inspect without forcing a bureaucratic layout."
      aside={<StatusBadge tone="warning">{asset.status}</StatusBadge>}
    >
      <div className="summary-grid">
        <div className="summary-row">
          <span className="summary-label">Internal code</span>
          <span className="summary-value">{asset.code}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Current location</span>
          <span className="summary-value">{asset.location}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Project</span>
          <span className="summary-value">{asset.project}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Responsible</span>
          <span className="summary-value">{asset.responsible}</span>
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
      <SurfaceCard title="Event timeline" subtitle="Current state should always be traceable back to the sequence of actions that produced it.">
        <div className="timeline-list">
          {assetTimeline.map((event) => (
            <div key={event.timestamp + event.title} className="timeline-item">
              <span className="timeline-time">{event.timestamp}</span>
              <strong>{event.title}</strong>
              <span>{event.body}</span>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard title="Linked incidents" subtitle="Incident visibility should stay tied to custody and project context.">
        <div className="queue-list">
          {incidents.slice(0, 2).map((incident) => (
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
