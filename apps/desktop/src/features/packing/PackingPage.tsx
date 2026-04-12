import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { PackingSlipListQuery, PackingSlipSortField } from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { PackingSlipDetailPanel } from "./PackingSlipDetailPanel";
import { returnPackingSlipItems, usePackingDetail, usePackingList } from "./usePackingData";

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
  { value: "itemCount", label: "Item count", columnKey: "itemCount" },
  { value: "returnedCount", label: "Returned count", columnKey: "returnedCount" },
];

const workspaceId = DEFAULT_WORKSPACE_ID;

export const PackingPage = ({ projectId = null, projectName = null }: PackingPageProps) => {
  const isProjectMode = Boolean(projectId);
  const sectionScopeLabel = useSectionScopeLabel();
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
  const [returnFeedback, setReturnFeedback] = useState<string | null>(null);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
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
        eyebrow={isProjectMode ? "Project / Packing" : "Packing slips"}
        title={isProjectMode ? "Project dispatch and returns" : "Outgoing and return control"}
        body={
          isProjectMode
            ? `Dispatches, pending returns and custody handoff linked to ${projectName ?? "the current project"}.`
            : "Operational documents for dispatch, pending returns and custody handoff across active projects."
        }
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Packing slips unavailable: {error}</div> : null}
      {returnFeedback ? <div className="action-feedback action-feedback-success">{returnFeedback}</div> : null}

      <div className="split-layout">
        <SurfaceCard
          title={isProjectMode ? "Project slips" : "Slip registry"}
          subtitle={
            isProjectMode
              ? "Issued, partial-return, overdue and closed slips for this project."
              : "Issued, partial-return, overdue and closed slips visible in one operational queue."
          }
        >
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
              { key: "itemCount", label: "Items", align: "right", width: 74, minWidth: 62, render: (row) => row.itemCount },
              {
                key: "returnedCount",
                label: "Returned",
                align: "right",
                width: 84,
                minWidth: 72,
                render: (row) => row.returnedCount,
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
          error={returnError ?? detailError}
          isLoading={detailLoading}
          isSubmittingReturn={isSubmittingReturn}
          onReturnItems={async (assetIds, conditionIn, notes) => {
            if (!activePackingSlipId) {
              return;
            }

            try {
              setIsSubmittingReturn(true);
              const result = await returnPackingSlipItems({
                commandId: crypto.randomUUID(),
                workspaceId,
                packingSlipId: activePackingSlipId,
                assetIds,
                conditionIn,
                notes,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([reload(), reloadDetail()]);
              setReturnError(null);
              setReturnFeedback(result.summary);
            } catch (nextError) {
              setReturnError(nextError instanceof Error ? nextError.message : "Unable to register packing return.");
            } finally {
              setIsSubmittingReturn(false);
            }
          }}
        />
      </div>
    </div>
  );
};
