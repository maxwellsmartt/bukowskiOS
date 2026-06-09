import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { PackingInsuranceExportOptions, PackingSlipListQuery, PackingSlipSortField } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { PackingSlipDetailPanel } from "./PackingSlipDetailPanel";
import {
  exportPackingSlipInsurancePdf,
  exportPackingSlipPdf,
  returnPackingSlipItems,
  usePackingDetail,
  usePackingList,
} from "./usePackingData";

type PackingPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

type PackingStatusFilter = "all" | "open" | "overdue" | "pending" | "closed";

const packingSortOptions: Array<ListSortOption<PackingSlipSortField>> = [
  { value: "issuedDate", label: "packing.sort.issuedDate", columnKey: "issuedDate" },
  { value: "dueDate", label: "packing.sort.dueDate", columnKey: "dueDate" },
  { value: "number", label: "packing.sort.number", columnKey: "number" },
  { value: "project", label: "packing.sort.project", columnKey: "project" },
  { value: "department", label: "packing.sort.department", columnKey: "department" },
  { value: "responsible", label: "packing.sort.responsible", columnKey: "responsible" },
  { value: "status", label: "packing.sort.status", columnKey: "status" },
  { value: "itemCount", label: "packing.sort.itemCount", columnKey: "itemCount" },
  { value: "returnedCount", label: "packing.sort.returnedCount", columnKey: "returnedCount" },
];

export const PackingPage = ({ projectId = null, projectName = null }: PackingPageProps) => {
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const isProjectMode = Boolean(projectId);
  const [searchParams] = useSearchParams();
  const packingControls = useListControls<PackingSlipSortField, PackingSlipListQuery>({
    viewKey: isProjectMode ? "project-packing-list" : "packing-list",
    defaults: {
      search: "",
      sortBy: "issuedDate",
      sortDirection: "desc",
    },
    sortOptions: packingSortOptions,
    defaultDirectionBySort: {
      dueDate: "asc",
      issuedDate: "desc",
      itemCount: "desc",
      returnedCount: "desc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      workspaceId: activeWorkspaceId,
      scopeProjectId: projectId,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, reload } = usePackingList(packingControls.query);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [activePackingSlipId, setActivePackingSlipId] = useState<string | null>(() =>
    readStringPreference(uiPreferenceKeys.activePackingSlipId),
  );
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const toast = useToast();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingInsurancePdf, setIsExportingInsurancePdf] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PackingStatusFilter>("all");
  const [isBatchExportingPdf, setIsBatchExportingPdf] = useState(false);
  const [isBatchExportingInsurancePdf, setIsBatchExportingInsurancePdf] = useState(false);
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = usePackingDetail(activePackingSlipId);
  const focusedPackingSlipId = searchParams.get("focus");
  const translatedSortOptions = packingSortOptions.map((option) => ({ ...option, label: t(option.label) }));
  const packingStats = useMemo(
    () => ({
      open: data.filter((row) => row.status !== "Closed").length,
      overdue: data.filter((row) => row.status === "Overdue").length,
      pendingSlips: data.filter((row) => Math.max(0, row.itemCount - row.returnedCount) > 0).length,
      pendingItems: data.reduce((total, row) => total + Math.max(0, row.itemCount - row.returnedCount), 0),
    }),
    [data],
  );
  const visiblePackingSlips = useMemo(
    () =>
      data.filter((row) => {
        const pendingCount = Math.max(0, row.itemCount - row.returnedCount);

        if (statusFilter === "open") {
          return row.status !== "Closed";
        }

        if (statusFilter === "overdue") {
          return row.status === "Overdue";
        }

        if (statusFilter === "pending") {
          return pendingCount > 0;
        }

        if (statusFilter === "closed") {
          return row.status === "Closed";
        }

        return true;
      }),
    [data, statusFilter],
  );
  const selectedPackingSlips = useMemo(() => visiblePackingSlips.filter((row) => selectedRowIds.includes(row.id)), [selectedRowIds, visiblePackingSlips]);
  const firstSelectedPackingSlip = selectedRowIds.length ? visiblePackingSlips.find((row) => row.id === selectedRowIds[0]) ?? null : null;
  const hasActiveFilters = Boolean(packingControls.searchValue.trim()) || statusFilter !== "all";
  const filterOptions = useMemo(
    () => [
      { value: "all" as const, label: t("packing.filters.all"), count: data.length },
      { value: "open" as const, label: t("packing.filters.open"), count: packingStats.open },
      { value: "overdue" as const, label: t("packing.filters.overdue"), count: packingStats.overdue },
      { value: "pending" as const, label: t("packing.filters.pending"), count: packingStats.pendingSlips },
      { value: "closed" as const, label: t("packing.filters.closed"), count: data.filter((row) => row.status === "Closed").length },
    ],
    [data, packingStats.open, packingStats.overdue, packingStats.pendingSlips, t],
  );

  useEffect(() => {
    if (!visiblePackingSlips.length) {
      setActivePackingSlipId(null);
      return;
    }

    if (activePackingSlipId && visiblePackingSlips.some((row) => row.id === activePackingSlipId)) {
      return;
    }

    setActivePackingSlipId(visiblePackingSlips[0]?.id ?? null);
  }, [activePackingSlipId, visiblePackingSlips]);

  useEffect(() => {
    if (focusedPackingSlipId && data.some((row) => row.id === focusedPackingSlipId)) {
      setActivePackingSlipId(focusedPackingSlipId);
    }
  }, [data, focusedPackingSlipId]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.activePackingSlipId, activePackingSlipId);
  }, [activePackingSlipId]);

  useEffect(() => {
    if (!selectedRowIds.length) {
      setSelectionActionsOpen(false);
    }
  }, [selectedRowIds.length]);

  const exportSelectedPackingSlips = async (type: "pdf" | "insurance") => {
    if (!selectedPackingSlips.length) {
      return;
    }

    const setBusy = type === "pdf" ? setIsBatchExportingPdf : setIsBatchExportingInsurancePdf;
    const exportOne = type === "pdf" ? exportPackingSlipPdf : exportPackingSlipInsurancePdf;
    setBusy(true);

    const failed: string[] = [];
    let exportedCount = 0;

    try {
      for (const slip of selectedPackingSlips) {
        try {
          await exportOne(slip.id);
          exportedCount += 1;
        } catch {
          failed.push(slip.number);
        }
      }

      if (failed.length) {
        setReturnError(t("packing.selection.batchExportPartial", { exported: exportedCount, failed: failed.join(", ") }));
        toast.info(t("packing.toasts.partialTitle"), t("packing.selection.batchExportPartial", { exported: exportedCount, failed: failed.join(", ") }));
        return;
      }

      setReturnError(null);
      toast.success(t("packing.toasts.doneTitle"), t(type === "pdf" ? "packing.selection.batchExportPdfDone" : "packing.selection.batchExportInsuranceDone", { count: exportedCount }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack packing-page-stack">
      <SectionHeader
        title={isProjectMode ? t("packing.titleProject") : t("packing.title")}
      />

      {error ? <div className="empty-state">{t("packing.unavailable", { message: error })}</div> : null}
      {returnError ? <div className="action-feedback action-feedback-error">{returnError}</div> : null}

      <ResizableSideRailLayout
        className="split-layout"
        defaultWidth={420}
        maxWidth={640}
        minWidth={320}
        storageKey={uiPreferenceKeys.splitSideRailWidth}
      >
        <SurfaceCard className="rail-table-card" title={t("packing.cardTitle")}>
          <ListToolbar
            activeSortLabel={packingControls.activeSortOption ? t(packingControls.activeSortOption.label) : undefined}
            onSearchValueChange={packingControls.setSearchValue}
            onSortByChange={packingControls.setSortField}
            onToggleSortDirection={packingControls.toggleSortDirection}
            resultCount={visiblePackingSlips.length}
            resultLabel={t("packing.resultLabel")}
            searchPlaceholder={isProjectMode ? t("packing.toolbar.searchPlaceholderProject") : t("packing.toolbar.searchPlaceholder")}
            searchValue={packingControls.searchValue}
            sortBy={packingControls.sortBy}
            sortDirection={packingControls.sortDirection}
            sortOptions={translatedSortOptions}
          />
          <div className="packing-overview-strip" aria-label={t("packing.overview.title")}>
            <span>
              <strong>{packingStats.open}</strong>
              {t("packing.overview.open")}
            </span>
            <span>
              <strong>{packingStats.overdue}</strong>
              {t("packing.overview.overdue")}
            </span>
            <span>
              <strong>{packingStats.pendingItems}</strong>
              {t("packing.overview.pendingUnits")}
            </span>
          </div>
          <div className="packing-filter-row" aria-label={t("packing.filters.title")}>
            {filterOptions.map((option) => (
              <button
                className={`filter-chip packing-filter-chip${statusFilter === option.value ? " active" : ""}`}
                key={option.value}
                onClick={() => setStatusFilter(option.value)}
                type="button"
              >
                <span>{option.label}</span>
                <strong>{option.count}</strong>
              </button>
            ))}
          </div>
          {selectedRowIds.length ? (
            <div className="selection-action-bar packing-selection-bar">
              <div className="selection-action-copy">
                <span className="selection-action-title">{t("packing.selection.title", { count: selectedRowIds.length })}</span>
                <span className="selection-action-subtitle">{t("packing.selection.compactSubtitle")}</span>
              </div>
              <div className="selection-action-buttons packing-selection-primary-actions">
                <button
                  className="ghost-control"
                  disabled={!firstSelectedPackingSlip}
                  onClick={() => {
                    if (!firstSelectedPackingSlip) {
                      return;
                    }
                    setActivePackingSlipId(firstSelectedPackingSlip.id);
                    setReturnError(null);
                  }}
                  type="button"
                >
                  {t("packing.selection.openFirst")}
                </button>
                <div className="packing-selection-more">
                  <button
                    aria-expanded={selectionActionsOpen}
                    className="ghost-control icon-control"
                    onClick={() => setSelectionActionsOpen((current) => !current)}
                    title={t("packing.selection.moreActions")}
                    type="button"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {selectionActionsOpen ? (
                    <div className="packing-selection-popover" role="menu">
                      <button
                        disabled={isBatchExportingPdf || !selectedPackingSlips.length}
                        onClick={() => {
                          setSelectionActionsOpen(false);
                          void exportSelectedPackingSlips("pdf");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{isBatchExportingPdf ? t("packing.selection.exporting") : t("packing.selection.exportPdf")}</span>
                      </button>
                      <button
                        disabled={isBatchExportingInsurancePdf || !selectedPackingSlips.length}
                        onClick={() => {
                          setSelectionActionsOpen(false);
                          void exportSelectedPackingSlips("insurance");
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{isBatchExportingInsurancePdf ? t("packing.selection.exporting") : t("packing.selection.exportInsurance")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRowIds([]);
                          setSelectionActionsOpen(false);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{t("packing.selection.clear")}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="selection-action-buttons packing-selection-expanded-actions">
                <button
                  className="ghost-control"
                  disabled={isBatchExportingPdf || !selectedPackingSlips.length}
                  onClick={() => void exportSelectedPackingSlips("pdf")}
                  type="button"
                >
                  {isBatchExportingPdf ? t("packing.selection.exporting") : t("packing.selection.exportPdf")}
                </button>
                <button
                  className="ghost-control"
                  disabled={isBatchExportingInsurancePdf || !selectedPackingSlips.length}
                  onClick={() => void exportSelectedPackingSlips("insurance")}
                  type="button"
                >
                  {isBatchExportingInsurancePdf ? t("packing.selection.exporting") : t("packing.selection.exportInsurance")}
                </button>
                <button className="ghost-control" onClick={() => setSelectedRowIds([])} type="button">
                  {t("packing.selection.clear")}
                </button>
              </div>
            </div>
          ) : null}
          <DataTable
            activeRowId={activePackingSlipId}
            autoScrollToActiveRow
            defaultVisibleColumnKeys={["number", "project", "dueDate", "progress", "status"]}
            emptyContent={
              <div className="packing-empty-state">
                <span className="packing-empty-kicker">{t(hasActiveFilters ? "packing.empty.filteredKicker" : "packing.empty.kicker")}</span>
                <strong>{t(hasActiveFilters ? "packing.empty.filteredTitle" : "packing.empty.title")}</strong>
                <span>{t(hasActiveFilters ? "packing.empty.filteredBody" : "packing.empty.body")}</span>
              </div>
            }
            getRowId={(row) => row.id}
            onSortRequest={packingControls.handleColumnSortRequest}
            persistKey="packing-slips-v2"
            shellClassName="table-shell-fill"
            columns={[
              { key: "number", label: t("packing.columns.slip"), width: 92, minWidth: 82, render: (row) => row.number },
              { key: "project", label: t("packing.columns.project"), width: 180, minWidth: 144, render: (row) => row.project },
              { key: "department", label: t("packing.columns.department"), width: 140, minWidth: 116, render: (row) => row.department },
              { key: "responsible", label: t("packing.columns.responsible"), width: 150, minWidth: 126, render: (row) => row.responsible },
              { key: "issuedDate", label: t("packing.columns.issued"), width: 90, minWidth: 80, render: (row) => row.issuedDate },
              { key: "dueDate", label: t("packing.columns.due"), width: 90, minWidth: 80, render: (row) => row.dueDate },
              { key: "itemCount", label: t("packing.columns.units"), align: "right", width: 74, minWidth: 62, render: (row) => row.itemCount },
              {
                key: "progress",
                label: t("packing.columns.progress"),
                width: 156,
                minWidth: 132,
                render: (row) => t("packing.progress", {
                  returned: row.returnedCount,
                  pending: Math.max(0, row.itemCount - row.returnedCount),
                }),
              },
              {
                key: "status",
                label: t("packing.columns.status"),
                width: 116,
                minWidth: 96,
                render: (row) => (
                  <StatusBadge
                    tone={
                      row.status === "Overdue"
                        ? "critical"
                        : row.status === "Closed"
                          ? "success"
                          : row.status === "Issued"
                            ? "info"
                            : "warning"
                    }
                  >
                    {t(`packing.statuses.${row.status}`, { defaultValue: row.status })}
                  </StatusBadge>
                ),
              },
            ]}
            rows={visiblePackingSlips}
            selectable
            selectedRowIds={selectedRowIds}
            sortState={
              packingControls.activeColumnKey
                ? {
                    columnKey: packingControls.activeColumnKey,
                    direction: packingControls.sortDirection,
                  }
                : null
            }
            onRowClick={(row) => {
              setActivePackingSlipId(row.id);
              setReturnError(null);
            }}
            rowActions={(row) => [
              {
                key: "open",
                label: t("shared.dataTable.openDetail"),
                onSelect: (target) => {
                  setActivePackingSlipId(target.id);
                  setReturnError(null);
                },
              },
            ]}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <PackingSlipDetailPanel
          data={detail}
          error={detailError}
          isExportingInsurancePdf={isExportingInsurancePdf}
          isExportingPdf={isExportingPdf}
          isLoading={detailLoading}
          isSubmittingReturn={isSubmittingReturn}
          onExportInsurancePdf={async (options: PackingInsuranceExportOptions) => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsExportingInsurancePdf(true);
              const result = await exportPackingSlipInsurancePdf(activePackingSlipId, options);
              setReturnError(null);
              toast.success(t("packing.toasts.doneTitle"), result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, t("packing.toasts.unableExportInsurance")));
            } finally {
              setIsExportingInsurancePdf(false);
            }
          }}
          onExportPdf={async () => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsExportingPdf(true);
              const result = await exportPackingSlipPdf(activePackingSlipId);
              setReturnError(null);
              toast.success(t("packing.toasts.doneTitle"), result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, t("packing.toasts.unableExportSlip")));
            } finally {
              setIsExportingPdf(false);
            }
          }}
          onReturnItems={async (assetIds, conditionIn, notes) => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsSubmittingReturn(true);
              const result = await returnPackingSlipItems({
                commandId: crypto.randomUUID(),
                workspaceId: activeWorkspaceId,
                packingSlipId: activePackingSlipId,
                assetIds,
                conditionIn,
                notes,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([reload(), reloadDetail()]);
              setReturnError(null);
              toast.success(t("packing.toasts.doneTitle"), result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, t("packing.toasts.unableReturn")));
            } finally {
              setIsSubmittingReturn(false);
            }
          }}
        />
      </ResizableSideRailLayout>
    </div>
  );
};
