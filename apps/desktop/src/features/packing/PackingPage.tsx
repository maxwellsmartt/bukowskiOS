import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { PackingSlipListQuery, PackingSlipSortField } from "@contracts";
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
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = usePackingDetail(activePackingSlipId);
  const focusedPackingSlipId = searchParams.get("focus");
  const translatedSortOptions = packingSortOptions.map((option) => ({ ...option, label: t(option.label) }));

  useEffect(() => {
    if (!data.length) {
      setActivePackingSlipId(null);
      return;
    }

    if (activePackingSlipId && data.some((row) => row.id === activePackingSlipId)) {
      return;
    }

    setActivePackingSlipId(data[0]?.id ?? null);
  }, [activePackingSlipId, data]);

  useEffect(() => {
    if (focusedPackingSlipId && data.some((row) => row.id === focusedPackingSlipId)) {
      setActivePackingSlipId(focusedPackingSlipId);
    }
  }, [data, focusedPackingSlipId]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.activePackingSlipId, activePackingSlipId);
  }, [activePackingSlipId]);

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
            resultCount={data.length}
            resultLabel={t("packing.resultLabel")}
            searchPlaceholder={isProjectMode ? t("packing.toolbar.searchPlaceholderProject") : t("packing.toolbar.searchPlaceholder")}
            searchValue={packingControls.searchValue}
            sortBy={packingControls.sortBy}
            sortDirection={packingControls.sortDirection}
            sortOptions={translatedSortOptions}
          />
          <DataTable
            activeRowId={activePackingSlipId}
            autoScrollToActiveRow
            getRowId={(row) => row.id}
            onSortRequest={packingControls.handleColumnSortRequest}
            persistKey="packing-slips"
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
            rows={data}
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
          onExportInsurancePdf={async () => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsExportingInsurancePdf(true);
              const result = await exportPackingSlipInsurancePdf(activePackingSlipId);
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
