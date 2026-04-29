import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { ScannableCodePanel } from "@shared/components/ScannableCodePanel";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { resolveAssetAvailability } from "@shared/lib/assetAvailability";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { printScannableLabel } from "@shared/utils/printScannableLabel";

import { AssetEditorPanel, type AssetEditorDraft } from "./AssetEditorPanel";
import { archiveAsset, deleteAssetFile, openAssetFile, updateAsset, uploadAssetFiles, uploadAssetImages, useAssetDetail } from "./useAssetsData";

const fileDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
});

const formatByteSize = (byteSize: number) => {
  if (!byteSize) {
    return "0 B";
  }

  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
};

const resolveFileTone = (status: "available" | "missing" | "deleted") => {
  if (status === "available") {
    return "success" as const;
  }

  if (status === "missing") {
    return "warning" as const;
  }

  return "critical" as const;
};

const isAssetImageFile = (file: { mimeType: string }) => file.mimeType.startsWith("image/");

export const AssetDetailPage = () => {
  const { assetId } = useParams();
  const [searchParams] = useSearchParams();
  const { activeWorkspaceId } = useWorkspace();
  const { data, reload } = useAssetDetail(assetId);
  const { projects, refreshProjects } = useShellContext();
  const { data: catalog, error: catalogError } = useCatalogData({
    workspaceId: activeWorkspaceId,
    entityType: "location",
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  });
  const [reportOpen, setReportOpen] = useState(() => searchParams.get("report") === "incident");
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorFeedback, setEditorFeedback] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesFeedback, setFilesFeedback] = useState<string | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isArchivingAsset, setIsArchivingAsset] = useState(false);

  if (!data.asset) {
    return <div className="empty-state">This asset does not exist anymore or was removed from the workspace.</div>;
  }

  const stockSummary = `${data.asset.quantity} available · ${data.asset.assignedQuantity} reserved · ${data.asset.checkedOutQuantity} checked out`;
  const availability = resolveAssetAvailability(data.asset);
  const secondaryCodes = data.scannableCodes.filter((code) => !code.isPrimary);
  const assetImages = data.files.filter((file) => file.status === "available" && isAssetImageFile(file)).slice(0, 2);
  const documentFiles = data.files.filter((file) => !isAssetImageFile(file));
  const remainingImageSlots = Math.max(0, 2 - assetImages.length);

  return (
    <div className="page-stack">
      <div className="entity-detail-action-bar">
        <button
          className="ghost-control"
          onClick={() => {
            setEditorOpen(true);
            setEditorError(null);
            setEditorFeedback(null);
          }}
          type="button"
        >
          Edit asset
        </button>
        <button
          className="action-primary-button"
          onClick={() => {
            setReportOpen(true);
            setReportError(null);
            setReportFeedback(null);
          }}
          type="button"
        >
          Report incident
        </button>
      </div>

      <SurfaceCard
        title={data.asset.name}
        aside={<StatusBadge tone={data.asset.status === "Maintenance" ? "warning" : "info"}>{data.asset.status}</StatusBadge>}
      >
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">Asset code</span>
            <span className="summary-value">{data.asset.code}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Current location</span>
            <span className="summary-value">{data.asset.location}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Stock</span>
            <span className="summary-value">{stockSummary}</span>
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
        </div>
      </SurfaceCard>

      <SurfaceCard
        title="Availability"
        aside={<StatusBadge tone={availability.tone}>{availability.label}</StatusBadge>}
      >
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">Status</span>
            <span className="summary-value">{availability.reason}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Next action</span>
            <span className="summary-value">{availability.nextAction}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Stock</span>
            <span className="summary-value">{stockSummary}</span>
          </div>
        </div>
      </SurfaceCard>

      {catalogError ? <div className="empty-state">Incident catalog unavailable: {catalogError}</div> : null}
      {reportFeedback ? <div className="action-feedback action-feedback-success">{reportFeedback}</div> : null}
      {editorFeedback ? <div className="action-feedback action-feedback-success">{editorFeedback}</div> : null}
      {filesFeedback ? <div className="action-feedback action-feedback-success">{filesFeedback}</div> : null}
      {filesError ? <div className="action-feedback action-feedback-error">{filesError}</div> : null}
      {data.asset.linkedKitCount ? (
        <div className="action-feedback action-feedback-warning">
          This asset is currently part of the active kit{data.asset.linkedKitCount === 1 ? "" : "s"} {data.asset.linkedKitCodes.join(", ")}. Remove it from the kit first before assigning or moving it individually.
        </div>
      ) : null}

      <SurfaceCard
        title="Asset images"
        aside={
          <button
            className="surface-card-action-text"
            disabled={isUploadingImages || remainingImageSlots <= 0}
            onClick={() => {
              setFilesError(null);
              setFilesFeedback(null);
              void (async () => {
                try {
                  setIsUploadingImages(true);
                  const result = await uploadAssetImages(data.asset!.id);
                  if (result.uploadedCount > 0) {
                    await reload();
                  }
                  setFilesFeedback(result.summary);
                } catch (nextError) {
                  setFilesError(getUserFacingErrorMessage(nextError, "Unable to add images to this asset."));
                } finally {
                  setIsUploadingImages(false);
                }
              })();
            }}
            type="button"
          >
            {isUploadingImages ? "Adding..." : remainingImageSlots <= 0 ? "2 images max" : "Add images"}
          </button>
        }
      >
        {assetImages.length ? (
          <div className="asset-image-gallery">
            {assetImages.map((file) => (
              <div
                key={file.id}
                className="asset-image-card"
              >
                <button
                  className="asset-image-open"
                  disabled={openingFileId === file.id || deletingFileId === file.id}
                  onClick={() => {
                    setFilesError(null);
                    void (async () => {
                      try {
                        setOpeningFileId(file.id);
                        await openAssetFile(file.id);
                      } catch (nextError) {
                        setFilesError(getUserFacingErrorMessage(nextError, "Unable to open that asset image."));
                        await reload();
                      } finally {
                        setOpeningFileId(null);
                      }
                    })();
                  }}
                  type="button"
                >
                  {file.previewDataUrl ? (
                    <img alt={file.originalName} className="asset-image-preview" src={file.previewDataUrl} />
                  ) : (
                    <span className="asset-image-preview asset-image-preview-placeholder">Preview unavailable</span>
                  )}
                </button>
                <div className="asset-image-meta-row">
                  <span className="asset-image-caption">{file.originalName}</span>
                  <button
                    aria-label={`Remove ${file.originalName}`}
                    className="asset-image-remove"
                    data-tooltip="Remove image"
                    disabled={deletingFileId === file.id}
                    onClick={() => {
                      const confirmed = window.confirm("Remove this asset image?");
                      if (!confirmed) {
                        return;
                      }

                      setFilesError(null);
                      setFilesFeedback(null);
                      void (async () => {
                        try {
                          setDeletingFileId(file.id);
                          const result = await deleteAssetFile(file.id);
                          await reload();
                          setFilesFeedback(result.summary);
                        } catch (nextError) {
                          setFilesError(getUserFacingErrorMessage(nextError, "Unable to remove that asset image."));
                        } finally {
                          setDeletingFileId(null);
                        }
                      })();
                    }}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="asset-image-empty">
            Add up to 2 JPEG or PNG images to make this asset easier to identify.
          </div>
        )}
      </SurfaceCard>

      {editorOpen && data.editor ? (
        <AssetEditorPanel
          categories={catalog.categories}
          error={editorError}
          initialValue={data.editor}
          isArchiving={isArchivingAsset}
          isSubmitting={isSubmittingEditor}
          locations={catalog.locations}
          mode="edit"
          onArchive={async () => {
            try {
              setIsArchivingAsset(true);
              const result = await archiveAsset({
                commandId: crypto.randomUUID(),
                workspaceId: activeWorkspaceId,
                assetId: data.asset!.id,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([reload(), refreshProjects()]);
              setEditorOpen(false);
              setEditorError(null);
              setEditorFeedback(result.summary);
            } catch (nextError) {
              setEditorError(getUserFacingErrorMessage(nextError, "Unable to archive asset."));
            } finally {
              setIsArchivingAsset(false);
            }
          }}
          onClose={() => {
            setEditorOpen(false);
            setEditorError(null);
          }}
          onSubmit={async (value: AssetEditorDraft) => {
            try {
              setIsSubmittingEditor(true);
              const result = await updateAsset({
                commandId: crypto.randomUUID(),
                workspaceId: activeWorkspaceId,
                assetId: data.asset!.id,
                actorType: "user",
                sourceChannel: "desktop",
                isActive: true,
                ...value,
              });

              await Promise.all([reload(), refreshProjects()]);
              setEditorOpen(false);
              setEditorError(null);
              setEditorFeedback(result.summary);
            } catch (nextError) {
              setEditorError(getUserFacingErrorMessage(nextError, "Unable to save asset changes."));
            } finally {
              setIsSubmittingEditor(false);
            }
          }}
        />
      ) : null}

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
                workspaceId: activeWorkspaceId,
                assetId: value.assetId,
                projectId: value.projectId,
                projectUnitId: value.projectUnitId,
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
              setReportError(getUserFacingErrorMessage(nextError, "Unable to create incident."));
            } finally {
              setIsSubmitting(false);
            }
          }}
          projects={projects}
          users={catalog.users}
        />
      ) : null}

      <ResizableSideRailLayout className="split-layout asset-detail-layout" defaultWidth={420} maxWidth={640} minWidth={320} storageKey="asset-detail-side-rail-width">
        <div className="page-stack">
          <SurfaceCard title="Details">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Tracking</span>
                <span className="summary-value">{data.asset.tracking}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Kit membership</span>
                <span className="summary-value">
                  {data.asset.linkedKitCount ? data.asset.linkedKitCodes.join(" · ") : "Standalone"}
                </span>
              </div>
            </div>

            {[
              data.asset.purchasePrice,
              data.asset.additionalCosts,
              data.asset.currentBookValue,
              data.asset.replacementValue,
            ].some((value) => value !== "Pending") ? (
              <div className="summary-grid compact-summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Insured value</span>
                  <span className="summary-value">{data.asset.insuredValue}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Purchase price</span>
                  <span className="summary-value">{data.asset.purchasePrice}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Additional costs</span>
                  <span className="summary-value">{data.asset.additionalCosts}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Current value</span>
                  <span className="summary-value">{data.asset.currentBookValue}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Replacement value</span>
                  <span className="summary-value">{data.asset.replacementValue}</span>
                </div>
              </div>
            ) : null}

            {data.editor?.primaryCodeValue ? (
              <ScannableCodePanel
                codeValue={data.editor.primaryCodeValue}
                subtitle="Primary code"
                title={data.asset.name}
                onPrint={({ qrDataUrl, barcodeDataUrl }) =>
                  printScannableLabel({
                    title: data.asset!.name,
                    subtitle: data.asset!.code,
                    codeValue: data.editor!.primaryCodeValue,
                    qrDataUrl,
                    barcodeDataUrl,
                  })
                }
              />
            ) : null}

            <details className="detail-disclosure">
              <summary className="detail-disclosure-summary">More details</summary>
              <div className="detail-disclosure-content">
                <div className="summary-grid">
                  <div className="summary-row">
                    <span className="summary-label">Primary code</span>
                    <span className="summary-value">{data.editor?.primaryCodeValue ?? "Pending"}</span>
                  </div>
                  {data.legacy ? (
                    <div className="summary-row">
                      <span className="summary-label">Source</span>
                      <span className="summary-value">{data.legacy.source}</span>
                    </div>
                  ) : null}
                </div>

                {data.legacy ? (
                  <div className="summary-grid">
                    <div className="summary-row">
                      <span className="summary-label">Legacy code</span>
                      <span className="summary-value">{data.legacy.legacyCode}</span>
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
                ) : null}

                {secondaryCodes.length ? (
                  <div className="queue-list">
                    {secondaryCodes.map((code) => (
                      <div key={code.id} className="queue-item">
                        <div className="identity-cell">
                          <span className="identity-title">{code.codeValue}</span>
                          <span className="identity-meta">{code.symbology.toUpperCase()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          </SurfaceCard>

          <SurfaceCard title="Timeline">
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
        </div>

        <div className="page-stack">
          <SurfaceCard
            title="Operations"
            aside={
              <button
                className="surface-card-action-text"
                disabled={isUploadingFiles}
                onClick={() => {
                  setFilesError(null);
                  setFilesFeedback(null);
                  void (async () => {
                    try {
                      setIsUploadingFiles(true);
                      const result = await uploadAssetFiles(data.asset!.id);
                      if (result.uploadedCount > 0) {
                        await reload();
                      }
                      setFilesFeedback(result.summary);
                    } catch (nextError) {
                      setFilesError(getUserFacingErrorMessage(nextError, "Unable to attach files to this asset."));
                    } finally {
                      setIsUploadingFiles(false);
                    }
                  })();
                }}
                type="button"
              >
                {isUploadingFiles ? "Uploading..." : "Attach PDF"}
              </button>
            }
          >
            <div className="entity-detail-section-stack">
              <section className="entity-detail-section">
                <header className="entity-detail-section-header">
                  <h3>Incidents</h3>
                  <span>{data.linkedIncidents.length || "None"}</span>
                </header>
                {data.linkedIncidents.length ? (
                  <div className="queue-list entity-detail-compact-list">
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
                  <div className="empty-state">No incidents linked.</div>
                )}
              </section>

              <section className="entity-detail-section">
                <header className="entity-detail-section-header">
                  <h3>Files</h3>
                  <span>{documentFiles.length || "None"}</span>
                </header>
                {documentFiles.length ? (
                  <div className="entity-file-list entity-detail-compact-list">
                    {documentFiles.map((file) => (
                      <div key={file.id} className="entity-file-row">
                        <div className="entity-file-main">
                          <div className="entity-file-head">
                            <span className="entity-file-name">{file.originalName}</span>
                            <StatusBadge tone={resolveFileTone(file.status)}>{file.status}</StatusBadge>
                          </div>
                          <div className="entity-file-meta">
                            <span>{file.fileType}</span>
                            <span>{formatByteSize(file.byteSize)}</span>
                            <span>{fileDateFormatter.format(new Date(file.createdAt))}</span>
                          </div>
                        </div>
                        <div className="entity-file-actions">
                          <button
                            className="ghost-control"
                            disabled={file.status !== "available" || openingFileId === file.id}
                            onClick={() => {
                              setFilesError(null);
                              void (async () => {
                                try {
                                  setOpeningFileId(file.id);
                                  await openAssetFile(file.id);
                                } catch (nextError) {
                                  setFilesError(getUserFacingErrorMessage(nextError, "Unable to open that asset file."));
                                  await reload();
                                } finally {
                                  setOpeningFileId(null);
                                }
                              })();
                            }}
                            type="button"
                          >
                            {openingFileId === file.id ? "Opening..." : "Open"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No files attached.</div>
                )}
              </section>
            </div>
          </SurfaceCard>
        </div>
      </ResizableSideRailLayout>
    </div>
  );
};
