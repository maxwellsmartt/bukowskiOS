import { Mail, Plus, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { RmaCaseStatus } from "@contracts";
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    () => buildAvailableRmaAssets(snapshot.maintenanceAssets, editorMode === "edit" ? detail : null),
    [detail, editorMode, snapshot.maintenanceAssets],
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
        setFeedback(result.summary);
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
        setFeedback(result.summary);
      }

      setEditorError(null);
      setInitialDraft(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, "Unable to save repair case."));
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
      setFeedback(result.summary);
      setEditorError(null);
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, "Unable to update repair status."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginCreate = () => {
    setEditorMode("create");
    setInitialDraft(null);
    setEditorError(null);
    setFeedback(null);
  };

  const isEmpty = !snapshotError && snapshot.cases.length === 0 && !editorMode;

  return (
    <div className="page-stack">
      <SectionHeader
        title="Repair cases"
        body="Manufacturer RMAs, warranty claims and repair workflows."
        titleTone="accent"
      />

      {snapshotError ? <div className="action-feedback action-feedback-error">{snapshotError}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      {isEmpty ? (
        <GuidedEmptyState
          title="No repair cases yet"
          body="Open an RMA when you need to send equipment to a manufacturer for warranty work or paid repair. You can always start one from an incident as well."
          actionLabel="New repair case"
          onAction={beginCreate}
          tips={[
            "Each case groups one or more assets sent to the same manufacturer.",
            "Status moves from Needs review → Sent to repair → Repaired/Returned.",
            "You can draft a support email straight from the case detail.",
          ]}
        />
      ) : (
        <SurfaceCard title="Maintenance watch">
          <DataTable
            getRowId={(row) => row.id}
            maxHeight="min(28vh, 240px)"
            persistKey="rma-page-maintenance-watch"
            columns={[
              {
                key: "asset",
                label: "Asset",
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || "Model pending"}</span>
                  </div>
                ),
              },
              { key: "serial", label: "Serial", render: (row) => row.serialNumber || "Pending" },
              { key: "location", label: "Location", render: (row) => row.location },
              { key: "issue", label: "Latest issue", render: (row) => row.latestIssue },
            ]}
            rows={snapshot.maintenanceAssets}
            emptyMessage="No assets currently flagged for maintenance."
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
                <span>New repair case</span>
              </button>
            }
            title="Cases"
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
                  label: "Case",
                  render: (row) => (
                    <div className="identity-cell">
                      <span className="identity-title">{row.title}</span>
                      <span className="identity-meta">{row.manufacturerName}</span>
                    </div>
                  ),
                },
                { key: "support", label: "Support", render: (row) => row.supportEmail || "Pending" },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => <StatusBadge tone={resolveRmaStatusTone(row.status)}>{row.status}</StatusBadge>,
                },
                { key: "assets", label: "Assets", align: "right", render: (row) => row.assetCount },
              ]}
              emptyMessage="No repair cases yet."
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
                      <span>Edit</span>
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
                      <span>Open draft email</span>
                    </button>
                  </div>
                ) : null
              }
              title={detail.caseRecord ? detail.caseRecord.title : "Case details"}
            >
              {detailError ? <div className="action-feedback action-feedback-error">{detailError}</div> : null}
              {editorError && !editorMode ? <div className="action-feedback action-feedback-error">{editorError}</div> : null}
              {!detail.caseRecord && !detailLoading ? <div className="empty-state">Select a case to see its details.</div> : null}

              {detail.caseRecord ? (
                <div className="page-stack">
                  <div className="summary-grid compact-summary-grid">
                    <div className="summary-row">
                      <span className="summary-label">Manufacturer</span>
                      <span className="summary-value">{detail.caseRecord.manufacturerName}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Support email</span>
                      <span className="summary-value">{detail.caseRecord.supportEmail || "Pending"}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Contact</span>
                      <span className="summary-value">{detail.caseRecord.contactName || "Pending"}</span>
                    </div>
                    <div className="summary-row">
                      <span className="summary-label">Phone</span>
                      <span className="summary-value">{detail.caseRecord.phone || "Pending"}</span>
                    </div>
                  </div>

                  <div className="chip-row">
                    <StatusBadge tone={resolveRmaStatusTone(detail.caseRecord.status)}>{detail.caseRecord.status}</StatusBadge>
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
                          {action.label}
                        </button>
                      ))}
                  </div>

                  <div className="summary-row">
                    <span className="summary-label">Problem summary</span>
                    <span className="summary-value">{detail.caseRecord.problemSummary}</span>
                  </div>

                  {detail.caseRecord.notes ? (
                    <div className="summary-row">
                      <span className="summary-label">Internal notes</span>
                      <span className="summary-value">{detail.caseRecord.notes}</span>
                    </div>
                  ) : null}

                  <DataTable
                    columns={[
                      {
                        key: "asset",
                        label: "Asset",
                        render: (row) => (
                          <div className="identity-cell">
                            <span className="identity-title">{row.assetName}</span>
                            <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || "Model pending"}</span>
                          </div>
                        ),
                      },
                      { key: "serial", label: "Serial", render: (row) => row.serialNumber || "Pending" },
                      { key: "year", label: "Year", render: (row) => row.equipmentYear || "Pending" },
                      { key: "issue", label: "Issue", render: (row) => row.issueSummary },
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
