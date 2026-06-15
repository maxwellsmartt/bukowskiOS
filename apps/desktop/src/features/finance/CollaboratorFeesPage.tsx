import { CheckCircle2, CreditCard, Plus, Wand2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CollaboratorFeeListQuery, CollaboratorFeeRow, CollaboratorFeeSortField, CollaboratorFeeSuggestion } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ModalShell } from "@shared/components/ModalShell";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { useCatalogData, useProjectsRegistry } from "@features/projects/useProjectsData";

import { CollaboratorFeeEditorPanel, type CollaboratorFeeDraft } from "./CollaboratorFeeEditorPanel";
import { CollaboratorPaymentPanel, type CollaboratorPaymentDraft } from "./CollaboratorPaymentPanel";
import { formatCurrency, newCommandId } from "./quoteHelpers";
import {
  approveCollaboratorFee,
  cancelCollaboratorFee,
  createCollaboratorFee,
  recordCollaboratorPayment,
  updateCollaboratorFee,
  useCollaboratorFeeSuggestions,
  useCollaboratorFeeSummary,
  useCollaboratorFees,
} from "./useFinanceData";

type FeeStatusFilter = CollaboratorFeeRow["status"] | "all";

const currencyOptions = ["DOP", "USD", "EUR"];
const statusFilters: FeeStatusFilter[] = ["all", "draft", "approved", "scheduled", "partially_paid", "paid", "cancelled"];

const today = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): CollaboratorFeeDraft => ({
  crewMemberId: "",
  projectId: "",
  projectUnitId: "",
  departmentId: "",
  sourceAssignmentId: "",
  feeType: "Crew fee",
  description: "",
  agreedAmount: "",
  currency: "DOP",
  expectedPaymentDate: today(),
  notes: "",
});

const statusTone = (status: CollaboratorFeeRow["status"]) => {
  if (status === "paid") return "success" as const;
  // Cancelled / draft are terminal-inactive or not-yet-live → neutral.
  if (status === "cancelled" || status === "draft") return "neutral" as const;
  if (status === "partially_paid" || status === "scheduled") return "warning" as const;
  return "info" as const;
};

const allocatePayment = (fees: CollaboratorFeeRow[], amount: number) => {
  let remaining = amount;
  const allocations: Array<{ feeId: string; amount: number }> = [];
  for (const fee of fees) {
    if (remaining <= 0) break;
    const nextAmount = Math.min(fee.outstandingAmount, remaining);
    if (nextAmount > 0) {
      allocations.push({ feeId: fee.id, amount: Number(nextAmount.toFixed(2)) });
      remaining = Number((remaining - nextAmount).toFixed(2));
    }
  }
  return allocations;
};

export const CollaboratorFeesPage = () => {
  const { t } = useTranslation();
  const { language } = useLocale();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<FeeStatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [crewFilter, setCrewFilter] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [editorDraft, setEditorDraft] = useState<CollaboratorFeeDraft | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<CollaboratorPaymentDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const sortOptions = useMemo<Array<ListSortOption<CollaboratorFeeSortField>>>(
    () => [
      { value: "expectedDate", label: "finance.collaboratorFees.sort.expectedDate", columnKey: "expectedDate" },
      { value: "crew", label: "finance.collaboratorFees.sort.crew", columnKey: "crew" },
      { value: "project", label: "finance.collaboratorFees.sort.project", columnKey: "project" },
      { value: "feeType", label: "finance.collaboratorFees.sort.feeType", columnKey: "feeType" },
      { value: "amount", label: "finance.collaboratorFees.sort.amount", columnKey: "amount" },
      { value: "outstanding", label: "finance.collaboratorFees.sort.outstanding", columnKey: "outstanding" },
      { value: "status", label: "finance.collaboratorFees.sort.status", columnKey: "status" },
    ],
    [],
  );
  const controls = useListControls<CollaboratorFeeSortField, CollaboratorFeeListQuery>({
    viewKey: "collaborator-fees-list",
    defaults: { search: "", sortBy: "expectedDate", sortDirection: "desc" },
    sortOptions,
    defaultDirectionBySort: { amount: "desc", outstanding: "desc", expectedDate: "desc" },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      search,
      sortBy,
      sortDirection,
      status: statusFilter,
      projectId: projectFilter || null,
      crewMemberId: crewFilter || null,
    }),
  });

  const { confirm, confirmDialog } = useConfirmDialog();
  const { data, error: loadError, isLoading, reload } = useCollaboratorFees({
    ...controls.query,
    status: statusFilter,
    projectId: projectFilter || null,
    crewMemberId: crewFilter || null,
  });
  const { data: summary, reload: reloadSummary } = useCollaboratorFeeSummary(projectFilter || null);
  const { data: suggestions, reload: reloadSuggestions } = useCollaboratorFeeSuggestions({
    projectId: projectFilter || null,
    crewMemberId: crewFilter || null,
  });
  const { data: catalog } = useCatalogData({ entityType: "crew", search: "", sortBy: "fullName", sortDirection: "asc" });
  const { data: projects } = useProjectsRegistry();

  const selectedFees = useMemo(() => data.filter((row) => selectedRowIds.includes(row.id)), [data, selectedRowIds]);
  const payableSelection = selectedFees.filter((fee) => fee.status !== "draft" && fee.status !== "cancelled" && fee.outstandingAmount > 0);
  const selectedTotal = payableSelection.reduce((sum, fee) => sum + fee.outstandingAmount, 0);
  const selectionCompatible =
    payableSelection.length > 0 &&
    payableSelection.every((fee) => fee.crewMemberId === payableSelection[0].crewMemberId && fee.currency === payableSelection[0].currency);

  const hasActiveFilters = statusFilter !== "all" || Boolean(projectFilter) || Boolean(crewFilter) || Boolean(controls.searchValue.trim());

  const statusLabel = (status: FeeStatusFilter) => t(`finance.collaboratorFees.statuses.${status}`, { defaultValue: status });

  const openCreate = (suggestion?: CollaboratorFeeSuggestion) => {
    setEditorError(null);
    setEditorDraft({
      ...emptyDraft(),
      crewMemberId: suggestion?.crewMemberId ?? "",
      projectId: suggestion?.projectId ?? projectFilter,
      projectUnitId: suggestion?.projectUnitId ?? "",
      departmentId: suggestion?.departmentId ?? "",
      sourceAssignmentId: suggestion?.sourceAssignmentId ?? "",
      feeType: suggestion?.feeType ?? "Crew fee",
      description: suggestion?.description ?? "",
      currency: suggestion?.currency ?? "DOP",
      expectedPaymentDate: suggestion?.endDate ?? today(),
    });
  };

  const openEdit = (fee: CollaboratorFeeRow) => {
    setEditorError(null);
    setEditorDraft({
      feeId: fee.id,
      crewMemberId: fee.crewMemberId,
      projectId: fee.projectId ?? "",
      projectUnitId: fee.projectUnitId ?? "",
      departmentId: fee.departmentId ?? "",
      sourceAssignmentId: fee.sourceAssignmentId ?? "",
      feeType: fee.feeType,
      description: fee.description ?? "",
      agreedAmount: String(fee.agreedAmount),
      currency: fee.currency,
      expectedPaymentDate: fee.expectedPaymentDate ?? "",
      notes: fee.notes ?? "",
    });
  };

  const refreshAll = () => {
    reload();
    reloadSummary();
    reloadSuggestions();
  };

  const submitDraft = async (draft: CollaboratorFeeDraft) => {
    const agreedAmount = Number(draft.agreedAmount);
    if (!draft.crewMemberId || !draft.feeType.trim() || !Number.isFinite(agreedAmount) || agreedAmount <= 0) {
      setEditorError(t("finance.collaboratorFees.validation.feeRequired"));
      return;
    }

    // Duplicate guard (only when creating a new fee).
    if (!draft.feeId) {
      const existing = (data ?? []).find(
        (fee) =>
          fee.crewMemberId === draft.crewMemberId &&
          fee.feeType.trim().toLowerCase() === draft.feeType.trim().toLowerCase() &&
          Math.abs(fee.agreedAmount - agreedAmount) < 0.005 &&
          (fee.projectId ?? "") === (draft.projectId || ""),
      );
      if (existing) {
        const proceed = await confirm({
          title: t("finance.collaboratorFees.confirmDuplicate.title"),
          body: t("finance.collaboratorFees.confirmDuplicate.body"),
          confirmLabel: t("finance.collaboratorFees.confirmDuplicate.action"),
          tone: "default",
        });
        if (!proceed) return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        commandId: newCommandId(draft.feeId ? "crew-fee-update" : "crew-fee-create"),
        workspaceId: activeWorkspaceId,
        crewMemberId: draft.crewMemberId,
        projectId: draft.projectId || null,
        projectUnitId: draft.projectUnitId || null,
        departmentId: draft.departmentId || null,
        sourceAssignmentId: draft.sourceAssignmentId || null,
        feeType: draft.feeType,
        description: draft.description || null,
        agreedAmount,
        currency: draft.currency,
        expectedPaymentDate: draft.expectedPaymentDate || null,
        notes: draft.notes || null,
        actorType: "user" as const,
        sourceChannel: "desktop" as const,
      };
      const result = draft.feeId
        ? await updateCollaboratorFee({ ...payload, feeId: draft.feeId })
        : await createCollaboratorFee(payload);
      toast.success(
        draft.feeId ? t("finance.collaboratorFees.toasts.feeUpdated") : t("finance.collaboratorFees.toasts.feeCreated"),
        result.summary,
      );
      setEditorDraft(null);
      setEditorError(null);
      refreshAll();
    } catch (nextError) {
      setEditorError(getUserFacingErrorMessage(nextError, t("finance.collaboratorFees.toasts.saveFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (fee: CollaboratorFeeRow) => {
    try {
      const result = await approveCollaboratorFee({
        commandId: newCommandId("crew-fee-approve"),
        workspaceId: activeWorkspaceId,
        feeId: fee.id,
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(t("finance.collaboratorFees.toasts.feeApproved"), result.summary);
      refreshAll();
    } catch (nextError) {
      toast.error(t("finance.collaboratorFees.toasts.approveFailed"), getUserFacingErrorMessage(nextError, t("finance.collaboratorFees.toasts.retry")));
    }
  };

  const handleCancel = async (fee: CollaboratorFeeRow) => {
    try {
      const result = await cancelCollaboratorFee({
        commandId: newCommandId("crew-fee-cancel"),
        workspaceId: activeWorkspaceId,
        feeId: fee.id,
        reason: t("finance.collaboratorFees.cancelReason"),
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(t("finance.collaboratorFees.toasts.feeCancelled"), result.summary);
      refreshAll();
    } catch (nextError) {
      toast.error(t("finance.collaboratorFees.toasts.cancelFailed"), getUserFacingErrorMessage(nextError, t("finance.collaboratorFees.toasts.retry")));
    }
  };

  const openPayment = () => {
    setPaymentError(null);
    setPaymentDraft({ amount: selectedTotal.toFixed(2), date: today(), method: "", reference: "", notes: "" });
  };

  const submitPayment = async (draft: CollaboratorPaymentDraft) => {
    if (!selectionCompatible || !payableSelection.length) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedTotal + 0.005) {
      setPaymentError(t("finance.collaboratorFees.validation.paymentRange"));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await recordCollaboratorPayment({
        commandId: newCommandId("crew-payment"),
        workspaceId: activeWorkspaceId,
        crewMemberId: payableSelection[0].crewMemberId,
        paidAt: draft.date,
        currency: payableSelection[0].currency,
        paymentMethod: draft.method || null,
        reference: draft.reference || null,
        notes: draft.notes || null,
        allocations: allocatePayment(payableSelection, amount),
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(t("finance.collaboratorFees.toasts.paymentRecorded"), result.summary);
      setPaymentDraft(null);
      setSelectedRowIds([]);
      setPaymentError(null);
      refreshAll();
    } catch (nextError) {
      setPaymentError(getUserFacingErrorMessage(nextError, t("finance.collaboratorFees.toasts.paymentFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack page-stack--fill">
      <div className="page-stack-row">
        <SectionHeader eyebrow={t("finance.title")} title={t("finance.collaboratorFees.title")} titleTone="accent" />
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="ghost-control" disabled={!selectionCompatible} onClick={openPayment} type="button">
            <CreditCard size={13} />
            <span>{t("finance.collaboratorFees.actions.recordPayment")}</span>
          </button>
          <button className="action-primary-button" onClick={() => openCreate()} type="button">
            <Plus size={13} />
            <span>{t("finance.collaboratorFees.actions.newFee")}</span>
          </button>
        </div>
      </div>

      <SurfaceCard className="quotes-summary-card">
        <div className="quotes-summary-grid">
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.collaboratorFees.summary.pending")}</span>
            <strong className="quotes-summary-tile-value">{formatCurrency(summary.pendingAmount, "DOP", language)}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.collaboratorFees.summary.approvedToPay")}</span>
            <strong className="quotes-summary-tile-value">{formatCurrency(summary.approvedAmount, "DOP", language)}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.collaboratorFees.summary.paidThisMonth")}</span>
            <strong className="quotes-summary-tile-value">{formatCurrency(summary.paidThisMonth, "DOP", language)}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.collaboratorFees.summary.withBalance")}</span>
            <strong className="quotes-summary-tile-value">{summary.collaboratorsWithBalance}</strong>
          </div>
        </div>
      </SurfaceCard>

      {loadError ? <div className="form-inline-error">{loadError}</div> : null}

      {suggestions.length ? (
        <SurfaceCard
          title={t("finance.collaboratorFees.suggestions.title")}
          subtitle={t("finance.collaboratorFees.suggestions.subtitle")}
        >
          <div className="quote-line-items-list">
            {suggestions.slice(0, 5).map((suggestion) => (
              <div className="quote-line-item-row" key={suggestion.suggestionId}>
                <div className="cell-stack">
                  <strong>{suggestion.description}</strong>
                  <small className="text-muted">{suggestion.startDate ?? "—"} → {suggestion.endDate ?? "—"}</small>
                </div>
                <button className="ghost-control" onClick={() => openCreate(suggestion)} type="button">
                  <Wand2 size={13} />
                  <span>{t("finance.collaboratorFees.suggestions.use")}</span>
                </button>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard className="surface-card--fill" title={t("finance.collaboratorFees.cardTitle")}>
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="compact-filter-field">
            <span>{t("finance.collaboratorFees.filters.project")}</span>
            <select className="compact-filter-select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">{t("finance.collaboratorFees.filters.allProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.code} · {project.name}</option>
              ))}
            </select>
          </label>
          <label className="compact-filter-field">
            <span>{t("finance.collaboratorFees.filters.crew")}</span>
            <select className="compact-filter-select" value={crewFilter} onChange={(event) => setCrewFilter(event.target.value)}>
              <option value="">{t("finance.collaboratorFees.filters.allCrew")}</option>
              {catalog.crewMembers.map((crew) => (
                <option key={crew.id} value={crew.id}>{crew.fullName}</option>
              ))}
            </select>
          </label>
        </div>

        <ListToolbar
          activeSortLabel={controls.activeSortOption ? t(controls.activeSortOption.label) : undefined}
          onSearchValueChange={controls.setSearchValue}
          onSortByChange={controls.setSortField}
          onToggleSortDirection={controls.toggleSortDirection}
          resultCount={data.length}
          resultLabel={t("finance.collaboratorFees.toolbar.resultLabel")}
          searchPlaceholder={t("finance.collaboratorFees.toolbar.searchPlaceholder")}
          searchValue={controls.searchValue}
          sortBy={controls.sortBy}
          sortDirection={controls.sortDirection}
          sortOptions={sortOptions.map((option) => ({ ...option, label: t(option.label) }))}
        />

        <div className="packing-filter-row" aria-label={t("finance.collaboratorFees.filters.status")}>
          {statusFilters.map((status) => (
            <button
              className={`filter-chip${statusFilter === status ? " active" : ""}`}
              key={status}
              onClick={() => setStatusFilter(status)}
              type="button"
            >
              <span>{statusLabel(status)}</span>
            </button>
          ))}
        </div>

        {isLoading && data.length === 0 ? <TableSkeleton rows={6} /> : null}

        <DataTable
          columns={[
            { key: "crew", label: t("finance.collaboratorFees.columns.crew"), render: (row) => row.crewMemberName },
            { key: "project", label: t("finance.collaboratorFees.columns.project"), render: (row) => row.projectName ?? "—" },
            { key: "feeType", label: t("finance.collaboratorFees.columns.feeType"), render: (row) => row.feeType },
            { key: "expectedDate", label: t("finance.collaboratorFees.columns.date"), render: (row) => row.expectedPaymentDate ?? "—" },
            { key: "amount", label: t("finance.collaboratorFees.columns.amount"), align: "right", render: (row) => formatCurrency(row.agreedAmount, row.currency, language) },
            { key: "outstanding", label: t("finance.collaboratorFees.columns.outstanding"), align: "right", render: (row) => formatCurrency(row.outstandingAmount, row.currency, language) },
            {
              key: "status",
              label: t("finance.collaboratorFees.columns.status"),
              render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>,
            },
          ]}
          emptyContent={
            <div className="table-empty-state">
              <span className="table-empty-kicker">{t("finance.collaboratorFees.empty.kicker")}</span>
              <strong>{hasActiveFilters ? t("finance.collaboratorFees.empty.filteredTitle") : t("finance.collaboratorFees.empty.title")}</strong>
              <span>{hasActiveFilters ? t("finance.collaboratorFees.empty.filteredBody") : t("finance.collaboratorFees.empty.body")}</span>
            </div>
          }
          fillParent
          getRowId={(row) => row.id}
          onRowClick={openEdit}
          rowActions={(row) => [
            { key: "edit", label: t("finance.collaboratorFees.rowActions.edit"), onSelect: (target) => openEdit(target) },
            {
              key: "approve",
              label: t("finance.collaboratorFees.rowActions.approve"),
              icon: <CheckCircle2 size={14} />,
              disabled: row.status !== "draft",
              onSelect: (target) => void handleApprove(target),
            },
            {
              key: "cancel",
              label: t("finance.collaboratorFees.rowActions.cancel"),
              icon: <XCircle size={14} />,
              tone: "danger",
              separatorBefore: true,
              disabled: row.status === "paid" || row.status === "cancelled" || row.paidAmount > 0,
              onSelect: (target) => void handleCancel(target),
            },
          ]}
          onSelectedRowIdsChange={setSelectedRowIds}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          persistKey="collaborator-fees"
        />
      </SurfaceCard>

      {editorDraft ? (
        <ModalShell onClose={() => setEditorDraft(null)} width={760}>
          <CollaboratorFeeEditorPanel
            crewMembers={catalog.crewMembers}
            currencyOptions={currencyOptions}
            error={editorError}
            initialDraft={editorDraft}
            isSubmitting={isSubmitting}
            onClose={() => setEditorDraft(null)}
            onSubmit={submitDraft}
            projects={projects}
          />
        </ModalShell>
      ) : null}

      {paymentDraft ? (
        <ModalShell onClose={() => setPaymentDraft(null)} width={640}>
          <CollaboratorPaymentPanel
            canSubmit={selectionCompatible}
            error={paymentError}
            initialDraft={paymentDraft}
            isSubmitting={isSubmitting}
            onClose={() => setPaymentDraft(null)}
            onSubmit={submitPayment}
            selectionSummary={t("finance.collaboratorFees.payment.selectionSummary", {
              count: payableSelection.length,
              amount: formatCurrency(selectedTotal, payableSelection[0]?.currency ?? "DOP", language),
            })}
          />
        </ModalShell>
      ) : null}

      {confirmDialog}
    </div>
  );
};

export default CollaboratorFeesPage;
