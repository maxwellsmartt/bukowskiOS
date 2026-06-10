import { Box, FileText, Mail, Plus, SquarePen, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { AssetListQuery, ListSortDirection, RmaCaseStatus } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAssetsList } from "@features/assets/useAssetsData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
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

type RmaCaseSortField = "recent" | "title" | "support" | "status" | "assets";

const rmaCaseSortOptions: Array<{ value: RmaCaseSortField; label: string; columnKey?: string }> = [
  { value: "recent", label: "rma.sort.recent" },
  { value: "title", label: "rma.sort.title", columnKey: "title" },
  { value: "support", label: "rma.sort.support", columnKey: "support" },
  { value: "status", label: "rma.sort.status", columnKey: "status" },
  { value: "assets", label: "rma.sort.assets", columnKey: "assets" },
];

export const RmaPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { data: snapshot, error: snapshotError, reload: reloadSnapshot } = useRmaSnapshot({
    workspaceId: activeWorkspaceId,
  });

  const [activeRmaCaseId, setActiveRmaCaseId] = useState<string | null>(null);
  const [pendingRmaCaseId, setPendingRmaCaseId] = useState<string | null>(null);
  // Set by the row context menu's "draft email": opens the mailto once the
  // case detail (which the email body needs) finishes loading.
  const [pendingMailCaseId, setPendingMailCaseId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!pendingMailCaseId || detail.caseRecord?.id !== pendingMailCaseId) {
      return;
    }

    setPendingMailCaseId(null);
    const url = buildRmaMailtoUrl(detail);
    if (url) {
      void window.bukowskiApp?.openExternal(url);
    }
  }, [detail, pendingMailCaseId]);

  // Deep links from incidents: ?focus=<caseId> selects an existing case;
  // ?newForAsset=<assetId> opens the create editor with that asset preselected.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedRmaCaseId = searchParams.get("focus");
  const newCaseForAssetId = searchParams.get("newForAsset");

  useEffect(() => {
    if (focusedRmaCaseId && snapshot.cases.some((row) => row.id === focusedRmaCaseId)) {
      setActiveRmaCaseId(focusedRmaCaseId);
    }
  }, [focusedRmaCaseId, snapshot.cases]);

  useEffect(() => {
    if (!newCaseForAssetId) {
      return;
    }

    setEditorMode("create");
    setInitialDraft({ assetItems: [{ assetId: newCaseForAssetId, issueSummary: "" }] });
    setEditorError(null);
    // Consume the param so re-renders or back navigation don't reopen the editor.
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("newForAsset");
      return next;
    }, { replace: true });
  }, [newCaseForAssetId, setSearchParams]);

  // Assets list backs the deep-link case: an incident can hand off an asset
  // that is NOT in maintenance status, and the picker must still show it.
  const { data: allAssets } = useAssetsList({
    workspaceId: activeWorkspaceId,
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  } satisfies AssetListQuery);

  const preselectedExtraAssets = useMemo(() => {
    if (editorMode !== "create" || !initialDraft?.assetItems?.length) {
      return [];
    }

    const maintenanceIds = new Set(snapshot.maintenanceAssets.map((asset) => asset.id));
    return initialDraft.assetItems
      .filter((item) => !maintenanceIds.has(item.assetId))
      .map((item) => allAssets.find((asset) => asset.id === item.assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        brand: "",
        model: asset.code,
        serialNumber: asset.serialNumber,
        location: asset.location,
        latestIssue: "",
      }));
  }, [allAssets, editorMode, initialDraft, snapshot.maintenanceAssets]);

  const availableAssets = useMemo(
    () =>
      buildAvailableRmaAssets(
        [...snapshot.maintenanceAssets, ...preselectedExtraAssets],
        editorMode === "edit" ? detail : null,
        t("rma.editor.alreadyLinked"),
      ),
    [detail, editorMode, preselectedExtraAssets, snapshot.maintenanceAssets, t],
  );

  const [searchValue, setSearchValue] = useState("");
  const [sortBy, setSortBy] = useState<RmaCaseSortField>("recent");
  const [sortDirection, setSortDirection] = useState<ListSortDirection>("desc");

  const visibleCases = useMemo(() => {
    const term = searchValue.trim().toLowerCase();
    const filtered = term
      ? snapshot.cases.filter((row) =>
          [row.title, row.manufacturerName, row.supportEmail, row.status]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(term)),
        )
      : snapshot.cases;

    if (sortBy === "recent") {
      // Snapshot already arrives ordered by updated_at DESC.
      return sortDirection === "desc" ? filtered : [...filtered].reverse();
    }

    const compare = (left: (typeof filtered)[number], right: (typeof filtered)[number]) => {
      if (sortBy === "assets") {
        return left.assetCount - right.assetCount;
      }
      if (sortBy === "support") {
        return left.supportEmail.localeCompare(right.supportEmail);
      }
      if (sortBy === "status") {
        return left.status.localeCompare(right.status);
      }
      return left.title.localeCompare(right.title);
    };

    const sorted = [...filtered].sort(compare);
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [searchValue, snapshot.cases, sortBy, sortDirection]);

  const activeSortOption = rmaCaseSortOptions.find((option) => option.value === sortBy);
  const activeColumnKey = activeSortOption?.columnKey ?? null;

  const handleColumnSortRequest = (columnKey: string) => {
    const option = rmaCaseSortOptions.find((candidate) => candidate.columnKey === columnKey);
    if (!option) {
      return;
    }
    if (option.value === sortBy) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(option.value);
      setSortDirection("asc");
    }
  };

  const beginCreateForAsset = (assetId: string, issueSummary = "") => {
    setEditorMode("create");
    setInitialDraft({ assetItems: [{ assetId, issueSummary }] });
    setEditorError(null);
  };

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
            rowActions={(row) => [
              {
                key: "create-case",
                label: t("rma.context.createCase"),
                icon: <Wrench size={14} />,
                onSelect: (target) => beginCreateForAsset(target.id, target.latestIssue),
              },
              {
                key: "view-asset",
                label: t("rma.context.viewAsset"),
                icon: <Box size={14} />,
                onSelect: (target) => navigate(`/assets/${target.id}`),
              },
            ]}
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
              {
                key: "issue",
                label: t("rma.columns.latestIssue"),
                render: (row) => row.latestIssue || t("rma.maintenance.noIssue"),
              },
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
            <ListToolbar
              activeSortLabel={activeSortOption ? t(activeSortOption.label) : undefined}
              onSearchValueChange={setSearchValue}
              onSortByChange={(value) => {
                setSortBy(value);
                setSortDirection(value === "recent" ? "desc" : "asc");
              }}
              onToggleSortDirection={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
              resultCount={visibleCases.length}
              resultLabel={t("rma.resultLabel")}
              searchPlaceholder={t("rma.toolbar.searchPlaceholder")}
              searchValue={searchValue}
              sortBy={sortBy}
              sortDirection={sortDirection}
              sortOptions={rmaCaseSortOptions.map((option) => ({ ...option, label: t(option.label) }))}
            />
            <DataTable
              activeRowId={activeRmaCaseId}
              autoScrollToActiveRow
              getRowId={(row) => row.id}
              maxHeight="min(54vh, 560px)"
              persistKey="rma-page-cases"
              onSortRequest={handleColumnSortRequest}
              sortState={activeColumnKey ? { columnKey: activeColumnKey, direction: sortDirection } : null}
              rowActions={(row) => [
                {
                  key: "open",
                  label: t("shared.dataTable.openDetail"),
                  icon: <FileText size={14} />,
                  onSelect: (target) => {
                    setActiveRmaCaseId(target.id);
                    setEditorMode(null);
                    setEditorError(null);
                  },
                },
                {
                  key: "edit",
                  label: t("common.edit"),
                  icon: <SquarePen size={14} />,
                  onSelect: (target) => {
                    setActiveRmaCaseId(target.id);
                    setEditorMode("edit");
                    setEditorError(null);
                  },
                },
                {
                  key: "email",
                  label: t("rma.actions.openDraftEmail"),
                  icon: <Mail size={14} />,
                  disabled: !row.supportEmail,
                  separatorBefore: true,
                  onSelect: (target) => {
                    setActiveRmaCaseId(target.id);
                    setPendingMailCaseId(target.id);
                  },
                },
              ]}
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
              rows={visibleCases}
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
