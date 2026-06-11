import { FileText, MoreHorizontal, Printer, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { PackingInsuranceExportOptions, PackingSlipListQuery, PackingSlipSortField } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ModalShell } from "@shared/components/ModalShell";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { notifyExportResult } from "@shared/lib/exportNotifications";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { PackingSlipDetailPanel } from "./PackingSlipDetailPanel";
import {
  exportPackingSlipInsurancePdf,
  exportPackingSlipPdf,
  printPackingSlipInsurancePdf,
  printPackingSlipPdf,
  returnPackingSlipItems,
  usePackingDetail,
  usePackingList,
} from "./usePackingData";

type PackingPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

type PackingStatusFilter = "all" | "open" | "overdue" | "pending" | "closed";

type PendingReturnTarget = {
  packingSlipId: string;
  number: string;
  pendingCount: number;
};

const returnConditionOptions = ["Good", "Review", "Damaged"] as const;

const getActivePackingPreferenceKey = (projectId?: string | null) =>
  projectId ? `${uiPreferenceKeys.activePackingSlipId}:${projectId}` : uiPreferenceKeys.activePackingSlipId;

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

const isPrinterUnavailableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /no printers available|printer.*network|no printer/i.test(message);
};

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
  const activePackingPreferenceKey = getActivePackingPreferenceKey(projectId);
  const [activePackingSlipId, setActivePackingSlipId] = useState<string | null>(() =>
    readStringPreference(activePackingPreferenceKey),
  );
  // True after the user closes the detail rail with the X: blocks the
  // auto-select-first effect until they pick a slip again.
  const [detailDismissed, setDetailDismissed] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const toast = useToast();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingInsurancePdf, setIsExportingInsurancePdf] = useState(false);
  const [isPrintingPdf, setIsPrintingPdf] = useState(false);
  const [isPrintingInsurancePdf, setIsPrintingInsurancePdf] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PackingStatusFilter>("all");
  const [isBatchExportingPdf, setIsBatchExportingPdf] = useState(false);
  const [isBatchExportingInsurancePdf, setIsBatchExportingInsurancePdf] = useState(false);
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [pendingReturnTarget, setPendingReturnTarget] = useState<PendingReturnTarget | null>(null);
  const [pendingReturnCondition, setPendingReturnCondition] = useState<string>("Good");
  const selectionActionsRef = useRef<HTMLDivElement | null>(null);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = usePackingDetail(activePackingSlipId);
  const focusedPackingSlipId = searchParams.get("focus");
  const translatedSortOptions = packingSortOptions.map((option) => ({ ...option, label: t(option.label) }));
  const packingStats = useMemo(
    () => ({
      open: data.filter((row) => row.status !== "Closed").length,
      overdue: data.filter((row) => row.status === "Overdue").length,
      pendingSlips: data.filter((row) => Math.max(0, row.itemCount - row.returnedCount) > 0).length,
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
    setActivePackingSlipId(readStringPreference(activePackingPreferenceKey));
    setDetailDismissed(false);
    setReturnError(null);
  }, [activePackingPreferenceKey]);

  useEffect(() => {
    if (detailDismissed) {
      return;
    }

    if (!visiblePackingSlips.length) {
      setActivePackingSlipId(null);
      return;
    }

    if (activePackingSlipId && visiblePackingSlips.some((row) => row.id === activePackingSlipId)) {
      return;
    }

    setActivePackingSlipId(visiblePackingSlips[0]?.id ?? null);
  }, [activePackingSlipId, detailDismissed, visiblePackingSlips]);

  useEffect(() => {
    if (focusedPackingSlipId && data.some((row) => row.id === focusedPackingSlipId)) {
      setActivePackingSlipId(focusedPackingSlipId);
      setDetailDismissed(false);
    }
  }, [data, focusedPackingSlipId]);

  useEffect(() => {
    writePreference(activePackingPreferenceKey, activePackingSlipId);
  }, [activePackingPreferenceKey, activePackingSlipId]);

  useEffect(() => {
    if (!selectedRowIds.length) {
      setSelectionActionsOpen(false);
    }
  }, [selectedRowIds.length]);

  useEffect(() => {
    if (!selectionActionsOpen) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (selectionActionsRef.current?.contains(event.target as Node)) {
        return;
      }
      setSelectionActionsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionActionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectionActionsOpen]);

  const openPackingSlip = (packingSlipId: string) => {
    setActivePackingSlipId(packingSlipId);
    setDetailDismissed(false);
    writePreference(activePackingPreferenceKey, packingSlipId);
    setReturnError(null);
  };

  const exportSinglePackingSlip = async (packingSlipId: string, type: "pdf" | "insurance") => {
    const setBusy = type === "pdf" ? setIsBatchExportingPdf : setIsBatchExportingInsurancePdf;
    const exportOne = type === "pdf" ? exportPackingSlipPdf : exportPackingSlipInsurancePdf;
    setBusy(true);
    try {
      const result = await exportOne(packingSlipId);
      setReturnError(null);
      notifyExportResult(toast, result, {
        successTitle: t("packing.toasts.doneTitle"),
        cancelledTitle: t("common.exportCancelled"),
        cancelledBody: t("common.exportCancelledBody"),
      });
    } catch (nextError) {
      setReturnError(
        getUserFacingErrorMessage(
          nextError,
          t(type === "pdf" ? "packing.toasts.unableExportSlip" : "packing.toasts.unableExportInsurance"),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const printSinglePackingSlip = async (packingSlipId: string, type: "pdf" | "insurance") => {
    const setBusy = type === "pdf" ? setIsPrintingPdf : setIsPrintingInsurancePdf;
    const printOne = type === "pdf" ? printPackingSlipPdf : printPackingSlipInsurancePdf;
    setBusy(true);
    try {
      const result = await printOne(packingSlipId);
      setReturnError(null);
      if (result.printed) {
        toast.success(t("packing.toasts.doneTitle"), result.summary);
      } else {
        toast.info(t("packing.toasts.printCancelledTitle"), result.summary);
      }
    } catch (nextError) {
      const message = isPrinterUnavailableError(nextError)
        ? t("packing.toasts.printerUnavailableBody")
        : getUserFacingErrorMessage(
            nextError,
            t(type === "pdf" ? "packing.toasts.unablePrintSlip" : "packing.toasts.unablePrintInsurance"),
          );
      toast.error(
        isPrinterUnavailableError(nextError) ? t("packing.toasts.printerUnavailableTitle") : t("packing.toasts.unablePrintTitle"),
        message,
      );
    } finally {
      setBusy(false);
    }
  };

  const returnPendingForSlip = async (packingSlipId: string, conditionIn: string) => {
    try {
      setIsSubmittingReturn(true);
      const result = await returnPackingSlipItems({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        packingSlipId,
        assetIds: [],
        conditionIn,
        actorType: "user",
        sourceChannel: "desktop",
      });

      setPendingReturnTarget(null);
      openPackingSlip(packingSlipId);
      await reload();
      setReturnError(null);
      toast.success(t("packing.toasts.doneTitle"), result.summary);
    } catch (nextError) {
      setReturnError(getUserFacingErrorMessage(nextError, t("packing.toasts.unableReturn")));
    } finally {
      setIsSubmittingReturn(false);
    }
  };

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
          const result = await exportOne(slip.id);
          if (result.saved) {
            exportedCount += 1;
          }
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
      if (exportedCount) {
        toast.success(t("packing.toasts.doneTitle"), t(type === "pdf" ? "packing.selection.batchExportPdfDone" : "packing.selection.batchExportInsuranceDone", { count: exportedCount }));
      } else {
        toast.show({
          title: t("common.exportCancelled"),
          body: t("common.exportCancelledBody"),
          tone: "cancelled",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`page-stack packing-page-stack${isProjectMode ? "" : " packing-page-stack--fill"}`}>
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
                    openPackingSlip(firstSelectedPackingSlip.id);
                  }}
                  type="button"
                >
                  {t("packing.selection.openFirst")}
                </button>
                <div className="packing-selection-more" ref={selectionActionsRef}>
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
              openPackingSlip(row.id);
            }}
            rowActions={(row) => [
              {
                key: "open",
                label: t("packing.context.open"),
                icon: <FileText size={14} />,
                onSelect: (target) => {
                  openPackingSlip(target.id);
                },
              },
              {
                key: "export-pdf",
                label: t("packing.context.exportPdf"),
                icon: <Upload size={14} />,
                disabled: isBatchExportingPdf,
                onSelect: (target) => {
                  void exportSinglePackingSlip(target.id, "pdf");
                },
              },
              {
                key: "export-insurance",
                label: t("packing.context.exportInsurance"),
                icon: <ShieldCheck size={14} />,
                disabled: isBatchExportingInsurancePdf,
                onSelect: (target) => {
                  void exportSinglePackingSlip(target.id, "insurance");
                },
              },
              {
                key: "print-pdf",
                label: t("packing.context.printPdf"),
                icon: <Printer size={14} />,
                disabled: isPrintingPdf,
                separatorBefore: true,
                onSelect: (target) => {
                  void printSinglePackingSlip(target.id, "pdf");
                },
              },
              {
                key: "print-insurance",
                label: t("packing.context.printInsurance"),
                icon: <Printer size={14} />,
                disabled: isPrintingInsurancePdf,
                onSelect: (target) => {
                  void printSinglePackingSlip(target.id, "insurance");
                },
              },
              {
                key: "return-pending",
                label: t("packing.context.returnPending"),
                icon: <RotateCcw size={14} />,
                disabled: isSubmittingReturn || Math.max(0, row.itemCount - row.returnedCount) < 1,
                separatorBefore: true,
                onSelect: (target) => {
                  setPendingReturnCondition("Good");
                  setPendingReturnTarget({
                    packingSlipId: target.id,
                    number: row.number,
                    pendingCount: Math.max(0, row.itemCount - row.returnedCount),
                  });
                },
              },
            ]}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        {activePackingSlipId ? (
        <PackingSlipDetailPanel
          data={detail}
          error={detailError}
          onClose={() => {
            setActivePackingSlipId(null);
            setDetailDismissed(true);
            writePreference(activePackingPreferenceKey, null);
          }}
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
              notifyExportResult(toast, result, {
                successTitle: t("packing.toasts.doneTitle"),
                cancelledTitle: t("common.exportCancelled"),
                cancelledBody: t("common.exportCancelledBody"),
              });
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
              notifyExportResult(toast, result, {
                successTitle: t("packing.toasts.doneTitle"),
                cancelledTitle: t("common.exportCancelled"),
                cancelledBody: t("common.exportCancelledBody"),
              });
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
        ) : null}
      </ResizableSideRailLayout>

      {pendingReturnTarget ? (
        <ModalShell
          className="packing-insurance-export-dialog"
          onClose={isSubmittingReturn ? () => undefined : () => setPendingReturnTarget(null)}
          width={440}
        >
          <div className="document-preview-header">
            <span className="document-preview-title">{t("packing.returnDialog.title")}</span>
            <button
              aria-label={t("common.cancel")}
              className="icon-ghost-control"
              disabled={isSubmittingReturn}
              onClick={() => setPendingReturnTarget(null)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <div className="packing-insurance-export-body">
            <p className="packing-return-dialog-copy">
              {t("packing.returnDialog.body", {
                count: pendingReturnTarget.pendingCount,
                number: pendingReturnTarget.number,
              })}
            </p>
            <label className="action-field">
              <span className="action-field-label">{t("packing.detail.conditionIn")}</span>
              <SelectField onChange={(event) => setPendingReturnCondition(event.target.value)} value={pendingReturnCondition}>
                {returnConditionOptions.map((option) => (
                  <option key={option} value={option}>
                    {t(`packing.conditions.${option}`)}
                  </option>
                ))}
              </SelectField>
            </label>
          </div>
          <div className="document-preview-header packing-insurance-export-footer">
            <button className="ghost-control" disabled={isSubmittingReturn} onClick={() => setPendingReturnTarget(null)} type="button">
              {t("common.cancel")}
            </button>
            <button
              className="action-primary-button"
              disabled={isSubmittingReturn}
              onClick={() => void returnPendingForSlip(pendingReturnTarget.packingSlipId, pendingReturnCondition)}
              type="button"
            >
              <RotateCcw size={15} />
              <span>
                {isSubmittingReturn
                  ? t("packing.detail.returning")
                  : t("packing.returnDialog.confirm", { count: pendingReturnTarget.pendingCount })}
              </span>
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
};
