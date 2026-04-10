import { useState } from "react";
import { useParams } from "react-router-dom";

import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";

import { useAssetDetail } from "./useAssetsData";

export const AssetDetailPage = () => {
  const { assetId } = useParams();
  const { data, reload } = useAssetDetail(assetId);
  const { projects, refreshProjects } = useShellContext();
  const { data: catalog, error: catalogError } = useCatalogData();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!data.asset) {
    return <div className="empty-state">Asset not found in the local workspace.</div>;
  }

  return (
    <div className="page-stack">
      <SurfaceCard
        title={data.asset.name}
        subtitle="Current status, quantity, storage context and recent history for this asset."
        aside={<StatusBadge tone={data.asset.status === "Maintenance" ? "warning" : "info"}>{data.asset.status}</StatusBadge>}
      >
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">Registry code</span>
            <span className="summary-value">{data.asset.code}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Quantity</span>
            <span className="summary-value">
              {data.asset.quantity} · {data.asset.tracking}
            </span>
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

        <div className="action-panel-actions action-panel-actions-start">
          <button
            className="action-primary-button"
            onClick={() => {
              setReportOpen(true);
              setReportError(null);
              setReportFeedback(null);
            }}
            type="button"
          >
            Report incident for this asset
          </button>
        </div>
      </SurfaceCard>

      {catalogError ? <div className="empty-state">Incident catalog unavailable: {catalogError}</div> : null}
      {reportFeedback ? <div className="action-feedback action-feedback-success">{reportFeedback}</div> : null}

      {reportOpen ? (
        <IncidentReportPanel
          assetLocked
          assetOptions={[
            {
              id: data.asset.id,
              code: data.asset.code,
              name: data.asset.name,
            },
          ]}
          departments={catalog.departments}
          error={reportError}
          initialValue={{
            assetId: data.asset.id,
            severity: "Medium",
          }}
          isSubmitting={isSubmitting}
          onClose={() => {
            setReportOpen(false);
            setReportError(null);
          }}
          onSubmit={async (value) => {
            try {
              setIsSubmitting(true);
              const result = await reportIncident({
                commandId: crypto.randomUUID(),
                workspaceId: "workspace-metadata",
                assetId: value.assetId,
                projectId: value.projectId,
                departmentId: value.departmentId,
                responsibleUserId: value.responsibleUserId,
                incidentType: value.incidentType,
                severity: value.severity,
                title: value.title,
                description: value.description,
                costEstimate: value.costEstimate,
                notes: value.notes,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([reload(), refreshProjects()]);
              setReportOpen(false);
              setReportError(null);
              setReportFeedback(result.summary);
            } catch (nextError) {
              setReportError(nextError instanceof Error ? nextError.message : "Unable to create incident.");
            } finally {
              setIsSubmitting(false);
            }
          }}
          projects={projects}
          users={catalog.users}
        />
      ) : null}

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

        <div className="page-stack">
          <SurfaceCard title="Legacy source" subtitle="Original fields preserved from the Rentman export.">
            {data.legacy ? (
              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Source</span>
                  <span className="summary-value">{data.legacy.source}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Legacy code</span>
                  <span className="summary-value">{data.legacy.legacyCode}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">QR code</span>
                  <span className="summary-value">{data.legacy.qrCode}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Warehouse slot</span>
                  <span className="summary-value">{data.legacy.warehouseSlot}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Folder path</span>
                  <span className="summary-value">{data.legacy.folderPath}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Accessories</span>
                  <span className="summary-value">{data.legacy.hasAccessories}</span>
                </div>
              </div>
            ) : (
              <div className="empty-state">No legacy source linked to this asset.</div>
            )}
          </SurfaceCard>

          <SurfaceCard title="Linked incidents" subtitle="Open and recent issues related to this asset.">
            {data.linkedIncidents.length ? (
              <div className="queue-list">
                {data.linkedIncidents.map((incident) => (
                  <div key={incident.id} className="queue-item">
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
            ) : (
              <div className="empty-state">No linked incidents for this asset yet.</div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
