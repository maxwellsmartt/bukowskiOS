import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { FinanceEntryListQuery, FinanceEntrySortField } from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { useAssetsList } from "@features/assets/useAssetsData";
import { useIncidentsData } from "@features/incidents/useIncidentsData";
import { useProjectsRegistry } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";

import { FinanceEntryEditorPanel, type FinanceEntryEditorDraft } from "./FinanceEntryEditorPanel";
import { createFinanceEntry, openFinanceDocument, updateFinanceEntry, uploadFinanceDocuments, useFinanceEntries, useFinanceEntryDocuments } from "./useFinanceData";

const financeEntrySortOptions: Array<ListSortOption<FinanceEntrySortField>> = [
  { value: "date", label: "Entry date", columnKey: "date" },
  { value: "type", label: "Type", columnKey: "type" },
  { value: "category", label: "Category", columnKey: "category" },
  { value: "reference", label: "Reference", columnKey: "reference" },
  { value: "project", label: "Project", columnKey: "project" },
  { value: "amount", label: "Amount", columnKey: "amount" },
  { value: "status", label: "Status", columnKey: "status" },
];

const workspaceId = DEFAULT_WORKSPACE_ID;

export const FinanceEntriesPage = () => {
  const [searchParams] = useSearchParams();
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
  const { data, error, reload } = useFinanceEntries(financeControls.query);
  const { data: projects } = useProjectsRegistry();
  const { data: assets } = useAssetsList();
  const { data: incidents } = useIncidentsData();
  const { addItems, hasItem } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const focusedEntryId = searchParams.get("focus");

  const editingEntry = useMemo(() => data.find((entry) => entry.id === editingEntryId) ?? null, [data, editingEntryId]);
  const { data: documents, reload: reloadDocuments } = useFinanceEntryDocuments(editingEntryId);

  useEffect(() => {
    if (!focusedEntryId || !data.some((entry) => entry.id === focusedEntryId)) {
      return;
    }

    setEditingEntryId(focusedEntryId);
    setSubmitError(null);
    setFeedback(null);
    setIsEditorOpen(true);
  }, [data, focusedEntryId]);

  const handleSubmit = async (draft: FinanceEntryEditorDraft) => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const result = editingEntry
        ? await updateFinanceEntry({
            commandId: crypto.randomUUID(),
            workspaceId,
            entryId: editingEntry.id,
            actorType: "user",
            sourceChannel: "desktop",
            ...draft,
          })
        : await createFinanceEntry({
            commandId: crypto.randomUUID(),
            workspaceId,
            actorType: "user",
            sourceChannel: "desktop",
            ...draft,
          });

      setFeedback(result.summary);
      setIsEditorOpen(false);
      setEditingEntryId(null);
      reload();
    } catch (nextError) {
      setSubmitError(nextError instanceof Error ? nextError.message : "The app could not save that finance entry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Entries"
        body="Keep reserves, exposure and invoice tracking editable from the register instead of treating Finance as read-only."
      />

      {error ? <div className="empty-state">Entries unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="success">{data.filter((entry) => hasItem("financial_entry", entry.id)).length} in compare</StatusBadge>
        {selectedRowIds.length ? <StatusBadge>{`${selectedRowIds.length} selected`}</StatusBadge> : null}
        {feedback ? <StatusBadge tone="info">{feedback}</StatusBadge> : null}
      </div>

      <div className="action-panel-actions action-panel-actions-start">
        <button
          className="action-primary-button"
          onClick={() => {
            setEditingEntryId(null);
            setSubmitError(null);
            setFeedback(null);
            setIsEditorOpen(true);
          }}
          type="button"
        >
          <Plus size={14} />
          <span>New entry</span>
        </button>
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

      {isEditorOpen ? (
        <FinanceEntryEditorPanel
          assets={assets}
          documents={documents}
          error={submitError}
          feedback={feedback}
          incidents={incidents}
          initialValue={editingEntry}
          isSubmitting={isSubmitting}
          isUploadingDocuments={isUploadingDocuments}
          mode={editingEntry ? "edit" : "create"}
          onAttachDocuments={async () => {
            if (!editingEntryId) {
              return;
            }

            try {
              setIsUploadingDocuments(true);
              const result = await uploadFinanceDocuments(editingEntryId);
              setFeedback(result.summary);
              setSubmitError(null);
              await reloadDocuments();
            } catch (nextError) {
              setSubmitError(nextError instanceof Error ? nextError.message : "The app could not attach finance documents.");
            } finally {
              setIsUploadingDocuments(false);
            }
          }}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingEntryId(null);
            setSubmitError(null);
          }}
          onOpenDocument={async (fileId) => {
            try {
              await openFinanceDocument(fileId);
              setSubmitError(null);
            } catch (nextError) {
              setSubmitError(nextError instanceof Error ? nextError.message : "The app could not open that finance document.");
            }
          }}
          onSubmit={handleSubmit}
          projects={projects}
        />
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
          activeRowId={editingEntryId}
          getRowId={(row) => row.id}
          maxHeight="min(56vh, 620px)"
          onRowClick={(row) => {
            setEditingEntryId(row.id);
            setSubmitError(null);
            setFeedback(null);
            setIsEditorOpen(true);
          }}
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
