import { Mail, Plus, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { RmaCaseStatus } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  RmaCaseEditorPanel,
  buildAvailableRmaAssets,
  type RmaCaseEditorDraft,
  type RmaCaseEditorInitialDraft,
} from "./RmaCaseEditorPanel";
import { buildRmaMailtoUrl, resolveRmaStatusTone, rmaStatusActions } from "./rmaHelpers";
import { createRmaCase, updateRmaCase, useRmaCaseDetail, useRmaSnapshot } from "./useRmaData";

export const RmaPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { data: snapshot, error: snapshotError, reload: reloadSnapshot } = useRmaSnapshot({
    workspaceId: activeWorkspaceId,
  });

  const [activeRmaCaseId, setActiveRmaCaseId] = useState<string | null>(null);
  const [pendingRmaCaseId, setPendingRmaCaseId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [initialDraft, setInitialDraft] = useState<RmaCaseEditorInitialDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();

  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    reload: reloadDetail,
  } = useRmaCaseDetail(activeRmaCaseId);

  useEffect(() => {
    if (isSubmitting) {
      return;
    }

    if (pendingRmaCaseId && activeRmaCaseId === pendingRmaCaseId && !snapshot.cases.some((row) => row.id === pendingRmaCaseId)) {
      return;
    }

    if (!snapshot.cases.length) {
      setActiveRmaCaseId(null);
      return;
    }

    if (activeRmaCaseId && snapshot.cases.some((row) => row.id === activeRmaCaseId)) {
      return;
    }

    setActiveRmaCaseId(snapshot.cases[0]?.id ?? null);
  }, [activeRmaCaseId, isSubmitting, pendingRmaCaseId, snapshot.cases]);

  useEffect(() => {
    if (pendingRmaCaseId && snapshot.cases.some((row) => row.id === pendingRmaCaseId)) {
      setPendingRmaCaseId(null);
    }
  }, [pendingRmaCaseId, snapshot.cases]);

  const availableAssets = useMemo(
    () => buildAvailableRmaAssets(snapshot.maintenanceAssets, editorMode === "edit" ? detail : null, t("rma.editor.alreadyLinked")),
    [detail, editorMode, snapshot.maintenanceAssets, t],
  );

  const handleSubmit = async (draft: RmaCaseEditorDraft) => {
    try {
      setIsSubmitting(true);

      if (editorMode === "edit" && detail.caseRecord) {
        const result = await updateRmaCase({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          rmaCaseId: detail.caseRecord.id,
          manufacturerId: draft.manufacturerId,
          supportEmail: draft.supportEmail,
          title: draft.title,
          problemSummary: draft.problemSummary,
          notes: draft.notes,
          status: draft.status,
          assetItems: draft.assetItems,
          actorType: "user",
          sourceChannel: "desktop",
        });

        await Promise.all([reloadSnapshot(), reloadDetail()]);
        toast.success(t("rma.toasts.updated"), result.summary);
      } else {
        const result = await createRmaCase({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          manufacturerId: draft.manufacturerId,
          supportEmail: draft.supportEmail,
          title: draft.title,
          problemSummary: draft.problemSummary,
          notes: draft.notes,
          assetItems: draft.assetItems,
          actorType: "user",
          sourceChannel: "desktop",
        });

        await reloadSnapshot();
        setPendingRmaCaseId(result.rmaCaseId);
        setActiveRmaCaseId(result.rmaCaseId);
        toast.success(t("rma.toasts.updated"), result.summary);
      }

      setEditorError(null);
      setInitialDraft(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("rma.toasts.saveFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (nextStatus: RmaCaseStatus) => {
    if (!detail.caseRecord) {
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await updateRmaCase({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        rmaCaseId: detail.caseRecord.id,
        manufacturerId: detail.caseRecord.manufacturerId,
        supportEmail: detail.caseRecord.supportEmail,
        title: detail.caseRecord.title,
        problemSummary: detail.caseRecord.problemSummary,
        notes: detail.caseRecord.notes,
        status: nextStatus,
        assetItems: detail.assets.map((asset) => ({
          assetId: asset.assetId,
          equipmentYear: asset.equipmentYear || undefined,
          issueSummary: asset.issueSummary,
        })),
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reloadSnapshot(), reloadDetail()]);
      toast.success(t("rma.toasts.updated"), result.summary);
      setEditorError(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("rma.toasts.statusFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginCreate = () => {
    setEditorMode("create");
    setInitialDraft(null);
    setEditorError(null);

  };

  const isEmpty = !snapshotError && snapshot.cases.length === 0 && !editorMode;

  return (
    <div className="page-stack">
      <SectionHeader
        title={t("rma.title")}
        body={t("rma.body")}
        titleTone="accent"
      />

      {snapshotError ? <div className="action-feedback action-feedback-error">{snapshotError}</div> : null}

      {isEmpty ? (
        <GuidedEmptyState
          title={t("rma.empty.title")}
          body={t("rma.empty.body")}
          actionLabel={t("rma.empty.action")}
          onAction={beginCreate}
          tips={[
            t("rma.empty.tipOne"),
            t("rma.empty.tipTwo"),
            t("rma.empty.tipThree"),
          ]}
        />
      ) : (
        <SurfaceCard title={t("rma.maintenance.title")}>
          <DataTable
            getRowId={(row) => row.id}
            maxHeight="min(28vh, 240px)"
            persistKey="rma-page-maintenance-watch"
            columns={[
              {
                key: "asset",
                label: t("rma.columns.asset"),
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || t("rma.fallbacks.modelPending")}</span>
                  </div>
                ),
              },
              { key: "serial", label: t("rma.columns.serial"), render: (row) => row.serialNumber || t("rma.fallbacks.pending") },
              { key: "location", label: t("rma.columns.location"), render: (row) => row.location },
              { key: "issue", label: t("rma.columns.latestIssue"), render: (row) => row.latestIssue },
            ]}
            rows={snapshot.maintenanceAssets}
            emptyMessage={t("rma.maintenance.empty")}
          />
        </SurfaceCard>
      )}

      {!isEmpty ? (
        <ResizableSideRailLayout
          className="split-layout"
          defaultWidth={420}
          maxWidth={680}
          minWidth={320}
          storageKey="rma-page-side-rail-width"
        >
          <SurfaceCard
            aside={
              <button className="action-primary-button" onClick={beginCreate} type="button">
                <Plus size={14} />
                <span>{t("rma.newCase")}</span>
              </button>
            }
            title={t("rma.cases.title")}
          >
            <DataTable
              activeRowId={activeRmaCaseId}
              autoScrollToActiveRow
              getRowId={(row) => row.id}
              maxHeight="min(54vh, 560px)"
              persistKey="rma-page-cases"
              columns={[
                {
                  key: "title",
                  label: t("rma.columns.case"),
                  render: (row) => (
                    <div className="identity-cell">
                      <span className="identity-title">{row.title}</span>
                      <span className="identity-meta">{row.manufacturerName}</span>
                    </div>
                  ),
                },
                { key: "support", label: t("rma.columns.support"), render: (row) => row.supportEmail || t("rma.fallbacks.pending") },
                {
                  key: "status",
                  label: t("rma.columns.status"),
                  render: (row) => (
                    <StatusBadge tone={resolveRmaStatusTone(row.status)}>
                      {t(`rma.statuses.${row.status}`, { defaultValue: row.status })}
                    </StatusBadge>
                  ),
                },
                { key: "assets", label: t("rma.columns.assets"), align: "right", render: (row) => row.assetCount },
              ]}
              emptyMessage={t("rma.cases.empty")}
              onRowClick={(row) => {
                setActiveRmaCaseId(row.id);
                setEditorMode(null);
                setEditorError(null);
              }}
              rows={snapshot.cases}
            />
          </SurfaceCard>

          {editorMode ? (
            <RmaCaseEditorPanel
              key={`${editorMode}-${detail.caseRecord?.id ?? "new"}`}
              availableAssets={availableAssets}
              error={editorError}
              initialDraft={editorMode === "create" ? initialDraft : null}
              initialValue={editorMode === "edit" ? detail : null}
              isSubmitting={isSubmitting}
              manufacturers={snapshot.manufacturers}
              mode={editorMode}
              onClose={() => {
                setEditorMode(null);
                setInitialDraft(null);
                setEditorError(null);
              }}
              onOpenCatalog={() => navigate("/catalog")}
              onSubmit={handleSubmit}
            />
          ) : (
            <SurfaceCard
              aside={
                detail.caseRecord ? (
                  <div className="surface-card-actions">
                    <button
                      className="ghost-control"
                      onClick={() => {
                        setEditorMode("edit");
                        setEditorError(null);
                      }}
                      type="button"
                    >
                      <SquarePen size={14} />
                      <span>{t("common.edit")}</span>
                    </button>
                    <button
                      className="ghost-control"
                      disabled={!detail.caseRecord.supportEmail}
                      onClick={() => {
                        const url = buildRmaMailtoUrl(detail);
                        if (url) {
                          void window.bukowskiApp?.openExternal(url);
                        }
                      }}
                      type="button"
                    >
                      <Mail size={14} />
                      <span>{t("rma.actions.openDraftEmail")}</span>
                    </button>
                  </div>
                ) : null
              }
              title={detail.caseRecord ? detail.caseRecord.title : t("rma.detail.title")}
            >
              {detailError ? <div className="action-feedback action-feedback-error">{detailError}</div> : null}
              {editorError && !editorMode ? <div className="action-feedback action-feedback-error">{editorError}</div> : null}
              {!detail.caseRecord && !detailLoading ? <div className="empty-state">{t("rma.detail.empty")}</div> : null}

              {detail.caseRecord ? (
                <div className="page-stack">
                  <div className="summary-grid compact-summary-grid">
                    <div className="summary-row">
                      <span className="summary-label">{t("rma.detail.manufacturer")}</span>
                      <span className="summary-value">{detail.caseRecord.manufacturerName}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("rma.detail.supportEmail")}</span>
                      <span className="summary-value">{detail.caseRecord.supportEmail || t("rma.fallbacks.pending")}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("rma.detail.contact")}</span>
                      <span className="summary-value">{detail.caseRecord.contactName || t("rma.fallbacks.pending")}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">{t("rma.detail.phone")}</span>
                      <span className="summary-value">{detail.caseRecord.phone || t("rma.fallbacks.pending")}</span>
                    </div>
                  </div>

                  <div className="chip-row">
                    <StatusBadge tone={resolveRmaStatusTone(detail.caseRecord.status)}>
                      {t(`rma.statuses.${detail.caseRecord.status}`, { defaultValue: detail.caseRecord.status })}
                    </StatusBadge>
                    {rmaStatusActions
                      .filter((action) => action.status !== detail.caseRecord?.status)
                      .map((action) => (
                        <button
                          key={action.status}
                          className={action.status === "No repair / retired" ? "ghost-control is-danger" : "ghost-control"}
                          disabled={isSubmitting}
                          onClick={() => void handleUpdateStatus(action.status)}
                          type="button"
                        >
                          {t(action.labelKey, { defaultValue: action.label })}
                        </button>
                      ))}
                  </div>

                  <div className="summary-row">
                    <span className="summary-label">{t("rma.detail.problemSummary")}</span>
                    <span className="summary-value">{detail.caseRecord.problemSummary}</span>
                  </div>

                  {detail.caseRecord.notes ? (
                    <div className="summary-row">
                      <span className="summary-label">{t("rma.detail.internalNotes")}</span>
                      <span className="summary-value">{detail.caseRecord.notes}</span>
                    </div>
                  ) : null}

                  <DataTable
                    columns={[
                      {
                        key: "asset",
                        label: t("rma.columns.asset"),
                        render: (row) => (
                          <div className="identity-cell">
                            <span className="identity-title">{row.assetName}</span>
                            <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || t("rma.fallbacks.modelPending")}</span>
                          </div>
                        ),
                      },
                      { key: "serial", label: t("rma.columns.serial"), render: (row) => row.serialNumber || t("rma.fallbacks.pending") },
                      { key: "year", label: t("rma.columns.year"), render: (row) => row.equipmentYear || t("rma.fallbacks.pending") },
                      { key: "issue", label: t("rma.columns.issue"), render: (row) => row.issueSummary },
                    ]}
                    maxHeight="min(34vh, 300px)"
                    persistKey="rma-page-case-assets"
                    rows={detail.assets}
                  />
                </div>
              ) : null}
            </SurfaceCard>
          )}
        </ResizableSideRailLayout>
      ) : null}
    </div>
  );
};
