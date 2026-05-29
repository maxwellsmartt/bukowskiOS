import { CheckCircle2, CreditCard, Plus, Wand2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CollaboratorFeeListQuery, CollaboratorFeeRow, CollaboratorFeeSortField, CollaboratorFeeSuggestion } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { useCatalogData, useProjectsRegistry } from "@features/projects/useProjectsData";

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

type FeeDraft = {
  feeId?: string;
  crewMemberId: string;
  projectId: string;
  projectUnitId: string;
  departmentId: string;
  sourceAssignmentId: string;
  feeType: string;
  description: string;
  agreedAmount: string;
  currency: string;
  expectedPaymentDate: string;
  notes: string;
};

const emptyDraft: FeeDraft = {
  crewMemberId: "",
  projectId: "",
  projectUnitId: "",
  departmentId: "",
  sourceAssignmentId: "",
  feeType: "Crew fee",
  description: "",
  agreedAmount: "",
  currency: "DOP",
  expectedPaymentDate: new Date().toISOString().slice(0, 10),
  notes: "",
};

const statusTone = (status: CollaboratorFeeRow["status"]) => {
  if (status === "paid") return "success" as const;
  // Cancelled is a terminal-inactive state → neutral (polish audit decision).
  if (status === "cancelled") return "neutral" as const;
  if (status === "draft") return "neutral" as const;
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
  const [statusFilter, setStatusFilter] = useState<CollaboratorFeeRow["status"] | "all">("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [crewFilter, setCrewFilter] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<FeeDraft | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortOptions = useMemo<Array<ListSortOption<CollaboratorFeeSortField>>>(
    () => [
      { value: "expectedDate", label: "Expected date", columnKey: "expectedDate" },
      { value: "crew", label: "Crew", columnKey: "crew" },
      { value: "project", label: "Project", columnKey: "project" },
      { value: "feeType", label: "Type", columnKey: "feeType" },
      { value: "amount", label: "Amount", columnKey: "amount" },
      { value: "outstanding", label: "Outstanding", columnKey: "outstanding" },
      { value: "status", label: "Status", columnKey: "status" },
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

  const openCreate = (suggestion?: CollaboratorFeeSuggestion) => {
    setError(null);
    setDraft({
      ...emptyDraft,
      crewMemberId: suggestion?.crewMemberId ?? "",
      projectId: suggestion?.projectId ?? projectFilter,
      projectUnitId: suggestion?.projectUnitId ?? "",
      departmentId: suggestion?.departmentId ?? "",
      sourceAssignmentId: suggestion?.sourceAssignmentId ?? "",
      feeType: suggestion?.feeType ?? "Crew fee",
      description: suggestion?.description ?? "",
      currency: suggestion?.currency ?? "DOP",
      expectedPaymentDate: suggestion?.endDate ?? emptyDraft.expectedPaymentDate,
    });
  };

  const openEdit = (fee: CollaboratorFeeRow) => {
    setError(null);
    setDraft({
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

  const submitDraft = async () => {
    if (!draft) return;
    const agreedAmount = Number(draft.agreedAmount);
    if (!draft.crewMemberId || !draft.feeType.trim() || !Number.isFinite(agreedAmount) || agreedAmount <= 0) {
      setError("Choose a collaborator, type and positive amount.");
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
          title: t("finance.collaboratorFees.confirmDuplicate.title", { defaultValue: "¿Honorario duplicado?" }),
          body: t("finance.collaboratorFees.confirmDuplicate.body", {
            defaultValue: "Ya existe un honorario con el mismo colaborador, tipo, monto y proyecto. ¿Crearlo de todos modos?",
          }),
          confirmLabel: t("finance.collaboratorFees.confirmDuplicate.action", { defaultValue: "Crear de todos modos" }),
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
      toast.success(draft.feeId ? "Honorario actualizado" : "Honorario creado", result.summary);
      setDraft(null);
      setError(null);
      refreshAll();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "No se pudo guardar el honorario."));
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
      toast.success("Honorario aprobado", result.summary);
      refreshAll();
    } catch (nextError) {
      toast.error("No se pudo aprobar", getUserFacingErrorMessage(nextError, "Intenta de nuevo."));
    }
  };

  const handleCancel = async (fee: CollaboratorFeeRow) => {
    try {
      const result = await cancelCollaboratorFee({
        commandId: newCommandId("crew-fee-cancel"),
        workspaceId: activeWorkspaceId,
        feeId: fee.id,
        reason: "Cancelled from Finance > Honorarios.",
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success("Honorario cancelado", result.summary);
      refreshAll();
    } catch (nextError) {
      toast.error("No se pudo cancelar", getUserFacingErrorMessage(nextError, "Intenta de nuevo."));
    }
  };

  const openPayment = () => {
    setPaymentAmount(selectedTotal.toFixed(2));
    setPaymentOpen(true);
    setError(null);
  };

  const submitPayment = async () => {
    if (!selectionCompatible || !payableSelection.length) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedTotal + 0.005) {
      setError("El monto debe ser positivo y no puede exceder el saldo seleccionado.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await recordCollaboratorPayment({
        commandId: newCommandId("crew-payment"),
        workspaceId: activeWorkspaceId,
        crewMemberId: payableSelection[0].crewMemberId,
        paidAt: paymentDate,
        currency: payableSelection[0].currency,
        paymentMethod: paymentMethod || null,
        reference: paymentReference || null,
        notes: paymentNotes || null,
        allocations: allocatePayment(payableSelection, amount),
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success("Pago registrado", result.summary);
      setPaymentOpen(false);
      setSelectedRowIds([]);
      setPaymentMethod("");
      setPaymentReference("");
      setPaymentNotes("");
      setError(null);
      refreshAll();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "No se pudo registrar el pago."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <SectionHeader eyebrow={t("finance.title", { defaultValue: "Finance" })} title="Honorarios y pagos" titleTone="accent" />
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="ghost-control" disabled={!selectionCompatible} onClick={openPayment} type="button">
            <CreditCard size={13} />
            <span>Registrar pago</span>
          </button>
          <button className="ghost-control is-active" onClick={() => openCreate()} type="button">
            <Plus size={13} />
            <span>Nuevo honorario</span>
          </button>
        </div>
      </div>

      <div className="quotes-summary-grid">
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">Pendiente</span>
          <strong className="quotes-summary-tile-value">{formatCurrency(summary.pendingAmount, "DOP", language)}</strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">Aprobado por pagar</span>
          <strong className="quotes-summary-tile-value">{formatCurrency(summary.approvedAmount, "DOP", language)}</strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">Pagado este mes</span>
          <strong className="quotes-summary-tile-value">{formatCurrency(summary.paidThisMonth, "DOP", language)}</strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">Con balance</span>
          <strong className="quotes-summary-tile-value">{summary.collaboratorsWithBalance}</strong>
        </SurfaceCard>
      </div>

      {loadError ? <div className="form-inline-error">{loadError}</div> : null}
      {error ? <div className="form-inline-error">{error}</div> : null}

      {draft ? (
        <SurfaceCard title={draft.feeId ? "Editar honorario" : "Nuevo honorario"}>
          <div className="agent-form-grid">
            <label className="field-block">
              <span className="field-label">Colaborador</span>
              <select className="field-input" value={draft.crewMemberId} onChange={(event) => setDraft({ ...draft, crewMemberId: event.target.value })}>
                <option value="">Selecciona colaborador</option>
                {catalog.crewMembers.map((crew) => (
                  <option key={crew.id} value={crew.id}>{crew.fullName}</option>
                ))}
              </select>
            </label>
            <label className="field-block">
              <span className="field-label">Proyecto</span>
              <select className="field-input" value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
                <option value="">Sin proyecto</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.code} · {project.name}</option>
                ))}
              </select>
            </label>
            <label className="field-block">
              <span className="field-label">Tipo</span>
              <input className="field-input" value={draft.feeType} onChange={(event) => setDraft({ ...draft, feeType: event.target.value })} />
            </label>
            <label className="field-block">
              <span className="field-label">Monto</span>
              <input className="field-input" inputMode="decimal" value={draft.agreedAmount} onChange={(event) => setDraft({ ...draft, agreedAmount: event.target.value })} />
            </label>
            <label className="field-block">
              <span className="field-label">Moneda</span>
              <select className="field-input" value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })}>
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="field-block">
              <span className="field-label">Fecha esperada</span>
              <input className="field-input" type="date" value={draft.expectedPaymentDate} onChange={(event) => setDraft({ ...draft, expectedPaymentDate: event.target.value })} />
            </label>
            <label className="field-block field-block-span-2">
              <span className="field-label">Descripción</span>
              <input className="field-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            <label className="field-block field-block-span-2">
              <span className="field-label">Notas</span>
              <textarea className="field-input" rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </label>
          </div>
          {draft.sourceAssignmentId ? <div className="action-feedback action-feedback-info">Prellenado desde una asignación de crew. Nada se crea hasta guardar.</div> : null}
          <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
            <button className="ghost-control" onClick={() => setDraft(null)} type="button">Cancelar</button>
            <button className="action-primary-button" disabled={isSubmitting} onClick={() => void submitDraft()} type="button">Guardar honorario</button>
          </div>
        </SurfaceCard>
      ) : null}

      {paymentOpen ? (
        <SurfaceCard title="Registrar pago">
          <div className="action-feedback action-feedback-info">
            {payableSelection.length} honorario(s), {formatCurrency(selectedTotal, payableSelection[0]?.currency ?? "DOP", language)} seleccionado(s).
          </div>
          <div className="agent-form-grid">
            <label className="field-block">
              <span className="field-label">Monto a pagar</span>
              <input className="field-input" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
            </label>
            <label className="field-block">
              <span className="field-label">Fecha</span>
              <input className="field-input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
            </label>
            <label className="field-block">
              <span className="field-label">Método</span>
              <input className="field-input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
            </label>
            <label className="field-block">
              <span className="field-label">Referencia</span>
              <input className="field-input" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
            </label>
            <label className="field-block field-block-span-2">
              <span className="field-label">Notas</span>
              <textarea className="field-input" rows={3} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} />
            </label>
          </div>
          <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
            <button className="ghost-control" onClick={() => setPaymentOpen(false)} type="button">Cancelar</button>
            <button className="action-primary-button" disabled={isSubmitting || !selectionCompatible} onClick={() => void submitPayment()} type="button">
              Registrar pago
            </button>
          </div>
        </SurfaceCard>
      ) : null}

      {suggestions.length ? (
        <SurfaceCard title="Sugerencias desde crew assignments" subtitle="Puedes convertir una asignación en honorario sin automatizar pagos.">
          <div className="quote-line-items-list">
            {suggestions.slice(0, 5).map((suggestion) => (
              <div className="quote-line-item-row" key={suggestion.suggestionId}>
                <div className="cell-stack">
                  <strong>{suggestion.description}</strong>
                  <small className="text-muted">{suggestion.startDate ?? "—"} → {suggestion.endDate ?? "—"}</small>
                </div>
                <button className="ghost-control" onClick={() => openCreate(suggestion)} type="button">
                  <Wand2 size={13} />
                  <span>Usar</span>
                </button>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard title="Honorarios">
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="compact-filter-field">
            <span>Estado</span>
            <select className="compact-filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              {["all", "draft", "approved", "scheduled", "partially_paid", "paid", "cancelled"].map((status) => (
                <option key={status} value={status}>{status.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="compact-filter-field">
            <span>Proyecto</span>
            <select className="compact-filter-select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.code} · {project.name}</option>
              ))}
            </select>
          </label>
          <label className="compact-filter-field">
            <span>Crew</span>
            <select className="compact-filter-select" value={crewFilter} onChange={(event) => setCrewFilter(event.target.value)}>
              <option value="">Todos</option>
              {catalog.crewMembers.map((crew) => (
                <option key={crew.id} value={crew.id}>{crew.fullName}</option>
              ))}
            </select>
          </label>
        </div>
        <ListToolbar
          activeSortLabel={controls.activeSortOption?.label}
          onSearchValueChange={controls.setSearchValue}
          onSortByChange={controls.setSortField}
          onToggleSortDirection={controls.toggleSortDirection}
          resultCount={data.length}
          resultLabel="honorarios"
          searchPlaceholder="Buscar por colaborador, proyecto o tipo"
          searchValue={controls.searchValue}
          sortBy={controls.sortBy}
          sortDirection={controls.sortDirection}
          sortOptions={sortOptions}
        />
        {isLoading && data.length === 0 ? <TableSkeleton rows={6} /> : null}
        <DataTable
          columns={[
            { key: "crew", label: "Colaborador", render: (row) => row.crewMemberName },
            { key: "project", label: "Proyecto", render: (row) => row.projectName ?? "—" },
            { key: "feeType", label: "Tipo", render: (row) => row.feeType },
            { key: "expectedDate", label: "Fecha", render: (row) => row.expectedPaymentDate ?? "—" },
            { key: "amount", label: "Monto", align: "right", render: (row) => formatCurrency(row.agreedAmount, row.currency, language) },
            { key: "outstanding", label: "Pendiente", align: "right", render: (row) => formatCurrency(row.outstandingAmount, row.currency, language) },
            { key: "status", label: "Estado", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</StatusBadge> },
            {
              key: "actions",
              label: "",
              align: "right",
              render: (row) => (
                <div className="surface-card-actions" style={{ justifyContent: "flex-end", gap: 6 }}>
                  <button className="icon-ghost-control" data-table-row-action onClick={() => void handleApprove(row)} title="Aprobar" type="button" disabled={row.status !== "draft"}>
                    <CheckCircle2 size={14} />
                  </button>
                  <button className="icon-ghost-control" data-table-row-action onClick={() => void handleCancel(row)} title="Cancelar" type="button" disabled={row.status === "paid" || row.status === "cancelled" || row.paidAmount > 0}>
                    <XCircle size={14} />
                  </button>
                </div>
              ),
            },
          ]}
          emptyContent={
            <GuidedEmptyState
              title="No hay honorarios todavía"
              body="Crea un honorario manual o usa una sugerencia desde asignaciones de crew."
              actionLabel="Nuevo honorario"
              onAction={() => openCreate()}
            />
          }
          getRowId={(row) => row.id}
          onRowClick={openEdit}
          rowActions={(row) => [
            { key: "edit", label: "Editar", onSelect: (target) => openEdit(target) },
            {
              key: "approve",
              label: "Aprobar",
              icon: <CheckCircle2 size={14} />,
              disabled: row.status !== "draft",
              onSelect: (target) => void handleApprove(target),
            },
            {
              key: "cancel",
              label: "Cancelar",
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
      {confirmDialog}
    </div>
  );
};

export default CollaboratorFeesPage;
