import { useEffect, useState } from "react";
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
  { value: "issuedDate", label: "Issued date", columnKey: "issuedDate" },
  { value: "dueDate", label: "Due date", columnKey: "dueDate" },
  { value: "number", label: "Slip number", columnKey: "number" },
  { value: "project", label: "Project", columnKey: "project" },
  { value: "department", label: "Department", columnKey: "department" },
  { value: "responsible", label: "Responsible", columnKey: "responsible" },
  { value: "status", label: "Status", columnKey: "status" },
  { value: "itemCount", label: "Unit count", columnKey: "itemCount" },
  { value: "returnedCount", label: "Returned count", columnKey: "returnedCount" },
];

export const PackingPage = ({ projectId = null, projectName = null }: PackingPageProps) => {
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
    <div className="page-stack">
      <SectionHeader
        title={isProjectMode ? "Project packing" : "Packing slips"}
      />

      {error ? <div className="empty-state">Packing slips unavailable: {error}</div> : null}
      {returnError ? <div className="action-feedback action-feedback-error">{returnError}</div> : null}

      <ResizableSideRailLayout
        className="split-layout"
        defaultWidth={420}
        maxWidth={640}
        minWidth={320}
        storageKey={uiPreferenceKeys.splitSideRailWidth}
      >
        <SurfaceCard title="Packing Slips">
          <ListToolbar
            activeSortLabel={packingControls.activeSortOption?.label}
            onSearchValueChange={packingControls.setSearchValue}
            onSortByChange={packingControls.setSortField}
            onToggleSortDirection={packingControls.toggleSortDirection}
            resultCount={data.length}
            resultLabel="slips"
            searchPlaceholder={isProjectMode ? "Search slips, departments or crew" : "Search slips, projects or crew"}
            searchValue={packingControls.searchValue}
            sortBy={packingControls.sortBy}
            sortDirection={packingControls.sortDirection}
            sortOptions={packingSortOptions}
          />
          <DataTable
            activeRowId={activePackingSlipId}
            autoScrollToActiveRow
            getRowId={(row) => row.id}
            maxHeight="min(68vh, 720px)"
            onSortRequest={packingControls.handleColumnSortRequest}
            persistKey="packing-slips"
            columns={[
              { key: "number", label: "Slip", width: 92, minWidth: 82, render: (row) => row.number },
              { key: "project", label: "Project", width: 180, minWidth: 144, render: (row) => row.project },
              { key: "department", label: "Department", width: 140, minWidth: 116, render: (row) => row.department },
              { key: "responsible", label: "Responsible", width: 150, minWidth: 126, render: (row) => row.responsible },
              { key: "issuedDate", label: "Issued", width: 90, minWidth: 80, render: (row) => row.issuedDate },
              { key: "dueDate", label: "Due", width: 90, minWidth: 80, render: (row) => row.dueDate },
              { key: "itemCount", label: "Units", align: "right", width: 74, minWidth: 62, render: (row) => row.itemCount },
              {
                key: "progress",
                label: "Progress",
                width: 156,
                minWidth: 132,
                render: (row) => `${row.returnedCount} returned · ${Math.max(0, row.itemCount - row.returnedCount)} pending`,
              },
              {
                key: "status",
                label: "Status",
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
                    {row.status}
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
              toast.success("Done", result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, "Unable to export insurance list PDF."));
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
              toast.success("Done", result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, "Unable to export packing slip PDF."));
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
              toast.success("Done", result.summary);
            } catch (nextError) {
              setReturnError(getUserFacingErrorMessage(nextError, "Unable to register packing return."));
            } finally {
              setIsSubmittingReturn(false);
            }
          }}
        />
      </ResizableSideRailLayout>
    </div>
  );
};
