import { useState } from "react";

import type { FinanceEntryListQuery, FinanceEntrySortField } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";

import { useFinanceEntries } from "./useFinanceData";

const financeEntrySortOptions: Array<ListSortOption<FinanceEntrySortField>> = [
  { value: "date", label: "Entry date", columnKey: "date" },
  { value: "type", label: "Type", columnKey: "type" },
  { value: "category", label: "Category", columnKey: "category" },
  { value: "reference", label: "Reference", columnKey: "reference" },
  { value: "project", label: "Project", columnKey: "project" },
  { value: "amount", label: "Amount", columnKey: "amount" },
  { value: "status", label: "Status", columnKey: "status" },
];

export const FinanceEntriesPage = () => {
  const financeControls = useListControls<FinanceEntrySortField, FinanceEntryListQuery>({
    viewKey: "finance-entries-list",
    defaults: {
      search: "",
      sortBy: "date",
      sortDirection: "desc",
    },
    sortOptions: financeEntrySortOptions,
    defaultDirectionBySort: {
      amount: "desc",
      date: "desc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error } = useFinanceEntries(financeControls.query);
  const { addItems, hasItem } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader title="Entries" />

      {error ? <div className="empty-state">Entries unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="success">{data.filter((entry) => hasItem("financial_entry", entry.id)).length} in compare</StatusBadge>
        {selectedRowIds.length ? <StatusBadge>{`${selectedRowIds.length} selected`}</StatusBadge> : null}
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {selectedRowIds.length === 1 ? "1 finance entry selected" : `${selectedRowIds.length} finance entries selected`}
            </span>
            <span className="selection-action-subtitle">Add entries to compare for reserve and exposure review.</span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="ghost-control"
              onClick={() =>
                addItems(
                  data
                    .filter((entry) => selectedRowIds.includes(entry.id))
                    .map((entry) => ({
                      id: entry.id,
                      entityType: "financial_entry" as const,
                      label: `${entry.reference} · ${entry.amount}`,
                      subtitle: `${entry.category} · ${entry.project}`,
                      meta: entry.type,
                    })),
                )
              }
              type="button"
            >
              Add to compare
            </button>
          </div>
        </div>
      ) : null}

      <SurfaceCard title="Entry register">
        <ListToolbar
          activeSortLabel={financeControls.activeSortOption?.label}
          onSearchValueChange={financeControls.setSearchValue}
          onSortByChange={financeControls.setSortField}
          onToggleSortDirection={financeControls.toggleSortDirection}
          resultCount={data.length}
          resultLabel="entries"
          searchPlaceholder="Search references, projects or categories"
          searchValue={financeControls.searchValue}
          sortBy={financeControls.sortBy}
          sortDirection={financeControls.sortDirection}
          sortOptions={financeEntrySortOptions}
        />
        <DataTable
          getRowId={(row) => row.id}
          maxHeight="min(56vh, 620px)"
          onSortRequest={financeControls.handleColumnSortRequest}
          persistKey="finance-entries"
          columns={[
            { key: "date", label: "Date", render: (row) => row.date },
            { key: "type", label: "Type", render: (row) => row.type },
            { key: "category", label: "Category", render: (row) => row.category },
            { key: "reference", label: "Reference", render: (row) => row.reference },
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "amount", label: "Amount", align: "right", render: (row) => row.amount },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <StatusBadge tone={row.status === "Draft" ? "warning" : "info"}>{row.status}</StatusBadge>
              ),
            },
          ]}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          sortState={
            financeControls.activeColumnKey
              ? {
                  columnKey: financeControls.activeColumnKey,
                  direction: financeControls.sortDirection,
                }
              : null
          }
          onSelectedRowIdsChange={setSelectedRowIds}
        />
      </SurfaceCard>
    </div>
  );
};
