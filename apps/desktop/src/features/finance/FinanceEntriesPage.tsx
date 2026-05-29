import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { FinanceEntryListQuery, FinanceEntrySortField } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAssetsList } from "@features/assets/useAssetsData";
import { useIncidentsData } from "@features/incidents/useIncidentsData";
import { useProjectsRegistry } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { FinanceEntryEditorPanel, type FinanceEntryEditorDraft } from "./FinanceEntryEditorPanel";
import { createFinanceEntry, openFinanceDocument, updateFinanceEntry, uploadFinanceDocuments, useFinanceEntries, useFinanceEntryDocuments } from "./useFinanceData";

export const FinanceEntriesPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId: workspaceId } = useWorkspace();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const financeEntrySortOptions = useMemo<Array<ListSortOption<FinanceEntrySortField>>>(
    () => [
      { value: "date", label: t("finance.entries.sort.entryDate"), columnKey: "date" },
      { value: "type", label: t("finance.entries.sort.type"), columnKey: "type" },
      { value: "category", label: t("finance.entries.sort.category"), columnKey: "category" },
      { value: "reference", label: t("finance.entries.sort.reference"), columnKey: "reference" },
      { value: "project", label: t("finance.entries.sort.project"), columnKey: "project" },
      { value: "amount", label: t("finance.entries.sort.amount"), columnKey: "amount" },
      { value: "status", label: t("finance.entries.sort.status"), columnKey: "status" },
    ],
    [t],
  );
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
  const { data, error, isLoading, reload } = useFinanceEntries(financeControls.query);
  const { data: projects } = useProjectsRegistry();
  const { data: assets } = useAssetsList();
  const { data: incidents } = useIncidentsData();
  const { addItems, hasItem } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
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

      toast.success(editingEntry ? t("finance.entries.toasts.updated") : t("finance.entries.toasts.created"), result.summary);
      setIsEditorOpen(false);
      setEditingEntryId(null);
      reload();
    } catch (nextError) {
      setSubmitError(getUserFacingErrorMessage(nextError, t("finance.entries.errors.save")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack page-stack--fill">
      <SectionHeader title={t("finance.entries.title")} />

      {error ? <div className="empty-state">{t("finance.entries.unavailable", { message: error })}</div> : null}

      <div className="chip-row">
        {selectedRowIds.length ? <StatusBadge>{t("finance.entries.selected", { count: selectedRowIds.length })}</StatusBadge> : null}
      </div>

      <div className="action-panel-actions action-panel-actions-start">
        <button
          className="action-primary-button"
          onClick={() => {
            setEditingEntryId(null);
            setSubmitError(null);
            setIsEditorOpen(true);
          }}
          type="button"
        >
          <Plus size={14} />
          <span>{t("finance.entries.newEntry")}</span>
        </button>
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {t("finance.entries.selectionTitle", { count: selectedRowIds.length })}
            </span>
            <span className="selection-action-subtitle">{t("finance.entries.selectionSubtitle")}</span>
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
              {t("finance.entries.addToCompare")}
            </button>
          </div>
        </div>
      ) : null}

      {isEditorOpen ? (
        <FinanceEntryEditorPanel
          assets={assets}
          documents={documents}
          error={submitError}
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
              toast.success(t("finance.entries.toasts.documentsAttached"), result.summary);
              setSubmitError(null);
              await reloadDocuments();
            } catch (nextError) {
              setSubmitError(getUserFacingErrorMessage(nextError, t("finance.entries.errors.attachDocuments")));
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
              setSubmitError(getUserFacingErrorMessage(nextError, t("finance.entries.errors.openDocument")));
            }
          }}
          onSubmit={handleSubmit}
          projects={projects}
        />
      ) : null}

      <SurfaceCard className="surface-card--fill" title={t("finance.entries.title")}>
        <ListToolbar
          activeSortLabel={financeControls.activeSortOption?.label}
          onSearchValueChange={financeControls.setSearchValue}
          onSortByChange={financeControls.setSortField}
          onToggleSortDirection={financeControls.toggleSortDirection}
          resultCount={data.length}
          resultLabel={t("finance.entries.resultLabel")}
          searchPlaceholder={t("finance.entries.searchPlaceholder")}
          searchValue={financeControls.searchValue}
          sortBy={financeControls.sortBy}
          sortDirection={financeControls.sortDirection}
          sortOptions={financeEntrySortOptions}
        />
        {isLoading && data.length === 0 ? (
          <TableSkeleton body={t("finance.entries.loading")} columns={6} />
        ) : null}
        <DataTable
          activeRowId={editingEntryId}
          fillParent
          emptyContent={
            <GuidedEmptyState
              title={financeControls.searchValue ? t("finance.entries.empty.noMatchesTitle") : t("finance.entries.empty.noEntriesTitle")}
              body={
                financeControls.searchValue
                  ? t("finance.entries.empty.noMatchesBody")
                  : t("finance.entries.empty.noEntriesBody")
              }
              tone="subtle"
              actionLabel={financeControls.searchValue ? t("finance.entries.empty.clearSearch") : t("finance.entries.empty.addFirst")}
              onAction={
                financeControls.searchValue
                  ? () => financeControls.setSearchValue("")
                  : () => {
                      setEditingEntryId(null);
                      setSubmitError(null);
                      setIsEditorOpen(true);
                    }
              }
              tips={
                financeControls.searchValue
                  ? undefined
                  : [
                      t("finance.entries.empty.tipProject"),
                      t("finance.entries.empty.tipDocuments"),
                      t("finance.entries.empty.tipStatus"),
                    ]
              }
            />
          }
          getRowId={(row) => row.id}
          onRowClick={(row) => {
            setEditingEntryId(row.id);
            setSubmitError(null);
            setIsEditorOpen(true);
          }}
          rowActions={(row) => [
            {
              key: "open",
              label: t("shared.dataTable.openDetail"),
              onSelect: (target) => {
                setEditingEntryId(target.id);
                setSubmitError(null);
                setIsEditorOpen(true);
              },
            },
          ]}
          onSortRequest={financeControls.handleColumnSortRequest}
          persistKey="finance-entries"
          columns={[
            { key: "date", label: t("finance.entries.columns.date"), render: (row) => row.date },
            { key: "type", label: t("finance.entries.columns.type"), render: (row) => row.type },
            { key: "category", label: t("finance.entries.columns.category"), render: (row) => row.category },
            { key: "reference", label: t("finance.entries.columns.reference"), render: (row) => row.reference },
            { key: "project", label: t("finance.entries.columns.project"), render: (row) => row.project },
            { key: "amount", label: t("finance.entries.columns.amount"), align: "right", render: (row) => row.amount },
            {
              key: "status",
              label: t("finance.entries.columns.status"),
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
