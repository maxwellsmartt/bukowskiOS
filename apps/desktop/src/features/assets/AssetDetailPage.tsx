import { FolderOpen, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { ScannableCodePanel } from "@shared/components/ScannableCodePanel";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { useShellContext } from "@shared/hooks/useShellContext";
import { resolveAssetAvailability, translateAssetAvailabilityLabel, translateAssetAvailabilityNextAction, translateAssetAvailabilityReason } from "@shared/lib/assetAvailability";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { printScannableLabel } from "@shared/utils/printScannableLabel";

import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { ModalShell } from "@shared/components/ModalShell";

import { AssetEditorPanel, type AssetEditorDraft } from "./AssetEditorPanel";
import { archiveAsset, deleteAssetFile, openAssetFile, updateAsset, uploadAssetFiles, uploadAssetImages, useAssetDetail } from "./useAssetsData";

const FILE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "2-digit",
  year: "numeric",
};

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
  const { t } = useTranslation();
  const { assetId } = useParams();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { formatDate } = useLocale();
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [pendingImageDelete, setPendingImageDelete] = useState<{ id: string; name: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; name: string; fileId: string } | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isArchivingAsset, setIsArchivingAsset] = useState(false);

  const openInFinder = (fileId: string) => {
    setFilesError(null);
    void (async () => {
      try {
        setOpeningFileId(fileId);
        await openAssetFile(fileId);
      } catch (nextError) {
        setFilesError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableOpenImage")));
        await reload();
      } finally {
        setOpeningFileId(null);
      }
    })();
  };

  useEffect(() => {
    if (!lightbox) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const handleConfirmImageDelete = async () => {
    if (!pendingImageDelete) {
      return;
    }

    const target = pendingImageDelete;
    setFilesError(null);
    

    try {
      setDeletingFileId(target.id);
      const result = await deleteAssetFile(target.id);
      await reload();
      toast.success(t("assets.detail.toasts.filesUpdated"), result.summary);
    } catch (nextError) {
      setFilesError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableRemoveImage")));
    } finally {
      setDeletingFileId(null);
      setPendingImageDelete(null);
    }
  };

  if (!data.asset) {
    return <div className="empty-state">{t("assets.detail.missing")}</div>;
  }

  const stockSummary = t("assets.detail.stockSummary", {
    assigned: data.asset.assignedQuantity,
    available: data.asset.quantity,
    checkedOut: data.asset.checkedOutQuantity,
  });
  const availability = resolveAssetAvailability(data.asset);
  const secondaryCodes = data.scannableCodes.filter((code) => !code.isPrimary);
  const assetImages = data.files.filter((file) => file.status === "available" && isAssetImageFile(file)).slice(0, 2);
  const documentFiles = data.files.filter((file) => !isAssetImageFile(file));
  const remainingImageSlots = Math.max(0, 2 - assetImages.length);

  return (
    <div className="page-stack is-dense entity-detail-scroll">
      <div className="entity-detail-action-bar">
        <button
          className="ghost-control action-row-button"
          onClick={() => {
            setEditorOpen(true);
            setEditorError(null);
          }}
          type="button"
        >
          {t("assets.detail.actions.editAsset")}
        </button>
        <button
          className="action-primary-button action-row-button"
          onClick={() => {
            setReportOpen(true);
            setReportError(null);
          }}
          type="button"
        >
          {t("assets.detail.actions.reportIncident")}
        </button>
      </div>

      <SurfaceCard
        title={data.asset.name}
        aside={
          <span data-tooltip={t("assets.detail.summary.lifecycleTooltip")}>
            <StatusBadge tone={data.asset.status === "Maintenance" ? "warning" : data.asset.status === "Retired" ? "critical" : "info"}>
              {data.asset.status}
            </StatusBadge>
          </span>
        }
      >
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.assetCode")}</span>
            <span className="summary-value">{data.asset.code}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.currentLocation")}</span>
            <span className="summary-value">{data.asset.location}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.stock")}</span>
            <span className="summary-value">{stockSummary}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.project")}</span>
            <span className="summary-value">{data.asset.project}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.responsible")}</span>
            <span className="summary-value">{data.asset.responsible}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.detail.summary.condition")}</span>
            <span className="summary-value">{data.asset.condition}</span>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard
        title={t("assets.availability.title")}
        subtitle={t("assets.availability.subtitle")}
        aside={
          <span data-tooltip={t("assets.availability.tooltip")}>
            <StatusBadge tone={availability.tone}>{translateAssetAvailabilityLabel(availability, t)}</StatusBadge>
          </span>
        }
      >
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">{t("assets.availability.currentState")}</span>
            <span className="summary-value">{translateAssetAvailabilityReason(availability, t)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.availability.toUse")}</span>
            <span className="summary-value">{translateAssetAvailabilityNextAction(availability, t)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.columns.stock")}</span>
            <span className="summary-value">{stockSummary}</span>
          </div>
        </div>
      </SurfaceCard>

      {catalogError ? <div className="empty-state">{t("assets.detail.catalogUnavailable", { message: catalogError })}</div> : null}
      {filesError ? <div className="action-feedback action-feedback-error">{filesError}</div> : null}
      <SurfaceCard
        title={t("assets.detail.images.title")}
        aside={
          <button
            className="surface-card-action-text"
            disabled={isUploadingImages || remainingImageSlots <= 0}
            onClick={() => {
              setFilesError(null);

              void (async () => {
                try {
                  setIsUploadingImages(true);
                  const result = await uploadAssetImages(data.asset!.id);
                  if (result.uploadedCount > 0) {
                    await reload();
                  }
                  toast.success(t("assets.detail.toasts.filesUpdated"), result.summary);
                } catch (nextError) {
                  setFilesError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableAddImages")));
                } finally {
                  setIsUploadingImages(false);
                }
              })();
            }}
            type="button"
          >
            {isUploadingImages
              ? t("assets.detail.images.adding")
              : remainingImageSlots <= 0
                ? t("assets.detail.images.max")
                : t("assets.detail.images.add")}
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
                  disabled={deletingFileId === file.id}
                  onClick={() => {
                    if (file.previewDataUrl) {
                      setLightbox({ src: file.previewDataUrl, name: file.originalName, fileId: file.id });
                    } else {
                      openInFinder(file.id);
                    }
                  }}
                  type="button"
                >
                  {file.previewDataUrl ? (
                    <img alt={file.originalName} className="asset-image-preview" src={file.previewDataUrl} />
                  ) : (
                    <span className="asset-image-preview asset-image-preview-placeholder">
                      {t("assets.detail.images.previewUnavailable")}
                    </span>
                  )}
                </button>
                <div className="asset-image-meta-row">
                  <span className="asset-image-caption">{file.originalName}</span>
                  <button
                    aria-label={t("assets.detail.images.removeAria", { name: file.originalName })}
                    className="asset-image-remove"
                    data-tooltip={t("assets.detail.images.remove")}
                    disabled={deletingFileId === file.id}
                    onClick={() => setPendingImageDelete({ id: file.id, name: file.originalName })}
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
            {t("assets.detail.images.empty")}
          </div>
        )}
      </SurfaceCard>

      {editorOpen && data.editor ? (
        <ModalShell
          onClose={() => {
            setEditorOpen(false);
            setEditorError(null);
          }}
        >
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
              toast.success(t("assets.detail.toasts.assetSaved"), result.summary);
            } catch (nextError) {
              setEditorError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableArchive")));
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
              toast.success(t("assets.detail.toasts.assetSaved"), result.summary);
            } catch (nextError) {
              setEditorError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableSaveChanges")));
            } finally {
              setIsSubmittingEditor(false);
            }
          }}
        />
        </ModalShell>
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
              toast.success(t("assets.detail.toasts.incidentReported"), result.summary);
            } catch (nextError) {
              setReportError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableCreateIncident")));
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
          <SurfaceCard title={t("assets.detail.sections.details")}>
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">{t("assets.detail.labels.tracking")}</span>
                <span className="summary-value">{data.asset.tracking}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("assets.detail.labels.kitMembership")}</span>
                <span className="summary-value">
                  {data.asset.linkedKitCount ? data.asset.linkedKitCodes.join(" · ") : t("assets.quickPreview.standalone")}
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
                  <span className="summary-label">{t("assets.detail.labels.insuredValue")}</span>
                  <span className="summary-value">{data.asset.insuredValue}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("assets.columns.purchasePrice")}</span>
                  <span className="summary-value">{data.asset.purchasePrice}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("assets.columns.additionalCosts")}</span>
                  <span className="summary-value">{data.asset.additionalCosts}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("assets.columns.currentValue")}</span>
                  <span className="summary-value">{data.asset.currentBookValue}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("assets.columns.replacementValue")}</span>
                  <span className="summary-value">{data.asset.replacementValue}</span>
                </div>
              </div>
            ) : null}

            {data.editor?.primaryCodeValue ? (
              <ScannableCodePanel
                codeValue={data.editor.primaryCodeValue}
                subtitle={t("assets.detail.labels.primaryCode")}
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
              <summary className="detail-disclosure-summary">{t("assets.detail.sections.moreDetails")}</summary>
              <div className="detail-disclosure-content">
                <div className="summary-grid">
                  <div className="summary-row">
                    <span className="summary-label">{t("assets.detail.labels.primaryCode")}</span>
                    <span className="summary-value">{data.editor?.primaryCodeValue ?? t("assets.detail.pending")}</span>
                  </div>
                  {data.legacy ? (
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.detail.labels.source")}</span>
                      <span className="summary-value">{data.legacy.source}</span>
                    </div>
                  ) : null}
                </div>

                {data.legacy ? (
                  <div className="summary-grid">
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.detail.labels.legacyCode")}</span>
                      <span className="summary-value">{data.legacy.legacyCode}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.detail.labels.warehouseSlot")}</span>
                      <span className="summary-value">{data.legacy.warehouseSlot}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.detail.labels.folderPath")}</span>
                      <span className="summary-value">{data.legacy.folderPath}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("assets.detail.labels.accessories")}</span>
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

          <SurfaceCard title={t("assets.detail.sections.timeline")}>
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
            title={t("assets.detail.sections.operations")}
            aside={
              <button
                className="surface-card-action-text"
                disabled={isUploadingFiles}
                onClick={() => {
                  setFilesError(null);
                  
                  void (async () => {
                    try {
                      setIsUploadingFiles(true);
                      const result = await uploadAssetFiles(data.asset!.id);
                      if (result.uploadedCount > 0) {
                        await reload();
                      }
                      toast.success(t("assets.detail.toasts.filesUpdated"), result.summary);
                    } catch (nextError) {
                      setFilesError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableAttachFiles")));
                    } finally {
                      setIsUploadingFiles(false);
                    }
                  })();
                }}
                type="button"
              >
                {isUploadingFiles ? t("assets.detail.files.uploading") : t("assets.detail.files.attachPdf")}
              </button>
            }
          >
            <div className="entity-detail-section-stack">
              <section className="entity-detail-section">
                <header className="entity-detail-section-header">
                  <h3>{t("assets.detail.sections.incidents")}</h3>
                  <span>{data.linkedIncidents.length || t("common.none")}</span>
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
                  <div className="empty-state">{t("assets.detail.files.noIncidents")}</div>
                )}
              </section>

              <section className="entity-detail-section">
                <header className="entity-detail-section-header">
                  <h3>{t("assets.detail.sections.files")}</h3>
                  <span>{documentFiles.length || t("common.none")}</span>
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
                            <span>{formatDate(file.createdAt, FILE_DATE_FORMAT)}</span>
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
                                  setFilesError(getUserFacingErrorMessage(nextError, t("assets.detail.toasts.unableOpenFile")));
                                  await reload();
                                } finally {
                                  setOpeningFileId(null);
                                }
                              })();
                            }}
                            type="button"
                          >
                            {openingFileId === file.id ? t("assets.detail.files.opening") : t("assets.detail.files.open")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">{t("assets.detail.noFiles")}</div>
                )}
              </section>
            </div>
          </SurfaceCard>
        </div>
      </ResizableSideRailLayout>

      {pendingImageDelete ? (
        <ConfirmDialog
          isOpen
          tone="danger"
          title={t("assets.detail.images.removeTitle", { name: pendingImageDelete.name })}
          body={t("assets.detail.images.removeBody")}
          confirmLabel={t("assets.detail.images.removeConfirm")}
          cancelLabel={t("assets.detail.images.removeCancel")}
          isSubmitting={deletingFileId === pendingImageDelete.id}
          onConfirm={handleConfirmImageDelete}
          onCancel={() => setPendingImageDelete(null)}
        />
      ) : null}

      {lightbox ? (
        <div
          className="asset-lightbox-overlay"
          onClick={() => setLightbox(null)}
          role="presentation"
        >
          <div className="asset-lightbox" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={lightbox.name}>
            <div className="asset-lightbox-header">
              <span className="asset-lightbox-title">{lightbox.name}</span>
              <div className="asset-lightbox-actions">
                <button
                  className="ghost-control action-row-button"
                  disabled={openingFileId === lightbox.fileId}
                  onClick={() => openInFinder(lightbox.fileId)}
                  type="button"
                >
                  <FolderOpen size={14} />
                  <span>{t("assets.detail.images.openInFinder")}</span>
                </button>
                <button
                  aria-label={t("common.close")}
                  className="icon-ghost-control"
                  onClick={() => setLightbox(null)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="asset-lightbox-body">
              <img alt={lightbox.name} src={lightbox.src} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
