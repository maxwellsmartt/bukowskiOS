import { Check, FileText, Image as ImageIcon, Loader2, Pencil, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  InvoiceExtraction,
  InvoiceExtractionProjectInput,
  InvoiceInboxFileInput,
  UpdateInvoiceExtractionCommand,
} from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { CompactSelect } from "@shared/components/CompactSelect";
import { CreatableSelect } from "@shared/components/CreatableSelect";
import { DataTable } from "@shared/components/DataTable";
import { DocumentPreviewModal } from "@shared/components/DocumentPreviewModal";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { StatusBadge } from "@shared/components/StatusBadge";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  useExpenseCategories,
  useInvoiceInbox,
  useTreasuryTransactions,
  useTreasuryMutations,
} from "./useTreasuryData";

const ACCEPTED = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_FILES = 60;
const MAX_BYTES = 15 * 1024 * 1024;
const UNASSIGNED = "__unassigned__";

const readFileAsDataUrl = (file: File): Promise<InvoiceInboxFileInput> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.onload = () =>
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl: String(reader.result ?? ""),
      });
    reader.readAsDataURL(file);
  });

const statusTone = (status: InvoiceExtraction["status"]): "neutral" | "info" | "success" | "warning" | "critical" => {
  switch (status) {
    case "applied":
      return "success";
    case "failed":
      return "critical";
    case "pending":
    case "processing":
      return "warning";
    case "extracted":
      return "info";
    default:
      return "neutral";
  }
};

type Member = { id: string; name: string };
type Project = { id: string; name: string };

type Props = {
  workspaceId: string;
  formatMoney: (value: number) => string;
};

export const InvoiceInboxPanel = ({ workspaceId, formatMoney }: Props) => {
  const { t } = useTranslation();
  const { user } = useSession();
  const inbox = useInvoiceInbox(workspaceId);
  const expenseCategories = useExpenseCategories(workspaceId);
  const mutations = useTreasuryMutations();
  const transactions = useTreasuryTransactions(
    useMemo(() => ({ workspaceId, limit: 1000 }), [workspaceId]),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploaderFilter, setUploaderFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Rows the user explicitly switched to multi-project mode (chips). By
  // default an invoice is assigned to a single project.
  const [multiModeIds, setMultiModeIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<InvoiceExtraction | null>(null);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [previewData, setPreviewData] = useState<{ dataUrl: string; mimeType: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Workspace members (for "linked user") + projects (for project tags).
  useEffect(() => {
    let cancelled = false;
    void window.bukowskiApp
      ?.getUsersSnapshot({ workspaceId })
      .then((snapshot) => {
        if (cancelled) return;
        setMembers(snapshot.users.map((u) => ({ id: u.id, name: u.fullName || u.email })));
      })
      .catch(() => undefined);
    void window.bukowskiProjects
      ?.getList({ workspaceId, search: "", sortBy: "name", sortDirection: "asc" })
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows.map((row) => ({ id: row.id, name: row.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Load the document bytes when a preview opens.
  useEffect(() => {
    if (!preview) {
      setPreviewData(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewData(null);
    void mutations
      .previewInvoiceDocument(workspaceId, preview.id)
      .then((result) => {
        if (cancelled || !result) return;
        setPreviewData({ dataUrl: result.dataUrl, mimeType: result.mimeType });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, workspaceId, mutations]);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  const txnLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of transactions.data) {
      map.set(row.id, `${row.txnDate} · ${row.rawDescription ?? "—"}`);
    }
    return map;
  }, [transactions.data]);

  const uploaderOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of inbox.data) {
      const key = row.uploadedByUserId ?? row.uploadedByName ?? "unknown";
      if (!seen.has(key)) {
        seen.set(key, row.uploadedByName ?? t("finance.treasury.invoices.unknownUploader", { defaultValue: "Sin usuario" }));
      }
    }
    return [
      { value: "all", label: t("finance.treasury.invoices.allUploaders", { defaultValue: "Todos los usuarios" }) },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [inbox.data, t]);

  const dateOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of inbox.data) {
      seen.add(row.createdAt.slice(0, 10));
    }
    return [
      { value: "all", label: t("finance.treasury.invoices.allDates", { defaultValue: "Todas las fechas" }) },
      ...Array.from(seen)
        .sort((a, b) => b.localeCompare(a))
        .map((value) => ({ value, label: value })),
    ];
  }, [inbox.data, t]);

  const memberOptions = useMemo(
    () => [
      { value: UNASSIGNED, label: t("finance.treasury.invoices.unassignedUser", { defaultValue: "Sin asignar" }) },
      ...members.map((member) => ({ value: member.id, label: member.name })),
    ],
    [members, t],
  );

  const filteredRows = useMemo(() => {
    return inbox.data.filter((row) => {
      const uploaderKey = row.uploadedByUserId ?? row.uploadedByName ?? "unknown";
      const matchUploader = uploaderFilter === "all" || uploaderKey === uploaderFilter;
      const matchDate = dateFilter === "all" || row.createdAt.slice(0, 10) === dateFilter;
      return matchUploader && matchDate;
    });
  }, [inbox.data, uploaderFilter, dateFilter]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).slice(0, MAX_FILES);
    const oversized = files.filter((file) => file.size > MAX_BYTES);
    if (oversized.length) {
      toast.error(t("finance.treasury.invoices.tooLarge", { defaultValue: "Algún archivo supera el límite de 15 MB." }));
    }
    const accepted = files.filter((file) => file.size <= MAX_BYTES);
    if (!accepted.length) return;
    setIsUploading(true);
    try {
      const payload = await Promise.all(accepted.map(readFileAsDataUrl));
      const result = await mutations.enqueueInvoices({
        workspaceId,
        files: payload,
        uploadedByUserId: user?.id ?? null,
        uploadedByName: user?.displayName ?? null,
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.uploadFailed", { defaultValue: "No se pudieron subir las facturas." })));
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const apply = async (row: InvoiceExtraction) => {
    if (!row.suggestedTransactionId) return;
    setBusyId(row.id);
    try {
      const result = await mutations.applyInvoiceExtraction({
        workspaceId,
        extractionId: row.id,
        transactionId: row.suggestedTransactionId,
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.applyFailed", { defaultValue: "No se pudo aplicar la factura." })));
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (row: InvoiceExtraction) => {
    setBusyId(row.id);
    try {
      await mutations.dismissInvoiceExtraction({ workspaceId, extractionId: row.id });
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.dismissFailed", { defaultValue: "No se pudo descartar." })));
    } finally {
      setBusyId(null);
    }
  };

  const setLinkedUser = async (row: InvoiceExtraction, value: string) => {
    const member = members.find((m) => m.id === value);
    try {
      await mutations.updateInvoiceExtraction({
        workspaceId,
        extractionId: row.id,
        linkedUserId: value === UNASSIGNED ? null : value,
        linkedUserName: value === UNASSIGNED ? null : member?.name ?? null,
      });
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.linkFailed", { defaultValue: "No se pudo vincular el usuario." })));
    }
  };

  const setProjects_ = async (row: InvoiceExtraction, next: InvoiceExtractionProjectInput[]) => {
    try {
      await mutations.updateInvoiceExtraction({ workspaceId, extractionId: row.id, projects: next });
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.projectFailed", { defaultValue: "No se pudieron guardar los proyectos." })));
    }
  };

  const addProject = (row: InvoiceExtraction, projectId: string) => {
    if (row.projects.some((p) => p.projectId === projectId)) return;
    const next: InvoiceExtractionProjectInput[] = [
      ...row.projects
        .filter((p): p is { projectId: string; projectName: string | null } => Boolean(p.projectId))
        .map((p) => ({ projectId: p.projectId as string, projectName: p.projectName })),
      { projectId, projectName: projectName.get(projectId) ?? null },
    ];
    void setProjects_(row, next);
  };

  const removeProject = (row: InvoiceExtraction, projectId: string) => {
    const next = row.projects
      .filter((p) => p.projectId && p.projectId !== projectId)
      .map((p) => ({ projectId: p.projectId as string, projectName: p.projectName }));
    // Drop back to the clean single-select once a row no longer needs chips.
    if (next.length <= 1) {
      setMultiModeIds((prev) => {
        const updated = new Set(prev);
        updated.delete(row.id);
        return updated;
      });
    }
    void setProjects_(row, next);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === filteredRows.length ? new Set() : new Set(filteredRows.map((row) => row.id)),
    );
  };

  const bulkAssignUser = async (value: string) => {
    const member = members.find((m) => m.id === value);
    try {
      const result = await mutations.bulkLinkInvoices({
        workspaceId,
        extractionIds: Array.from(selectedIds),
        linkedUserId: value === UNASSIGNED ? null : value,
        linkedUserName: value === UNASSIGNED ? null : member?.name ?? null,
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.linkFailed", { defaultValue: "No se pudo vincular el usuario." })));
    }
  };

  const bulkAddProject = async (projectId: string) => {
    try {
      const result = await mutations.bulkLinkInvoices({
        workspaceId,
        extractionIds: Array.from(selectedIds),
        projects: [{ projectId, projectName: projectName.get(projectId) ?? null }],
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.projectFailed", { defaultValue: "No se pudieron guardar los proyectos." })));
    }
  };

  return (
    <SurfaceCard>
      <h3 className="section-subtitle">{t("finance.treasury.invoices.title", { defaultValue: "Bandeja de facturas" })}</h3>
      <p className="invoice-inbox-hint">
        {t("finance.treasury.invoices.hint", {
          defaultValue:
            "Arrastra facturas en PNG, JPG o PDF. Se clasifican automáticamente y proponen un movimiento; nada se aplica hasta que lo confirmes.",
        })}
      </p>

      <button
        type="button"
        className={`invoice-dropzone${isDragging ? " is-dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        {isUploading ? <Loader2 className="spin" size={20} /> : <UploadCloud size={20} />}
        <span>
          {isUploading
            ? t("finance.treasury.invoices.uploading", { defaultValue: "Subiendo…" })
            : t("finance.treasury.invoices.dropHere", { defaultValue: "Haz clic o arrastra facturas aquí (PNG, JPG, PDF)" })}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          hidden
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </button>

      {inbox.data.length === 0 ? (
        <GuidedEmptyState
          body={t("finance.treasury.invoices.emptyBody", { defaultValue: "Aún no has subido facturas a esta bandeja." })}
          title={t("finance.treasury.invoices.emptyTitle", { defaultValue: "Sin facturas en cola" })}
        />
      ) : (
        <>
          {selectedIds.size > 0 ? (
            <div className="invoice-batch-bar">
              <span className="invoice-batch-bar-label">
                {t("finance.treasury.invoices.batchSelected", {
                  defaultValue: "{{count}} seleccionadas",
                  count: selectedIds.size,
                })}
              </span>
              <CompactSelect
                className="invoice-filter-select"
                ariaLabel={t("finance.treasury.invoices.batchAssignUser", { defaultValue: "Asignar usuario" })}
                value=""
                onChange={(value) => void bulkAssignUser(value)}
                options={[
                  { value: "", label: t("finance.treasury.invoices.batchAssignUser", { defaultValue: "Asignar usuario" }) },
                  ...memberOptions,
                ]}
              />
              <CompactSelect
                className="invoice-filter-select"
                ariaLabel={t("finance.treasury.invoices.batchAddProject", { defaultValue: "Agregar proyecto" })}
                value=""
                onChange={(value) => {
                  if (value) void bulkAddProject(value);
                }}
                options={[
                  { value: "", label: t("finance.treasury.invoices.batchAddProject", { defaultValue: "Agregar proyecto" }) },
                  ...projects.map((project) => ({ value: project.id, label: project.name })),
                ]}
              />
              <button className="ghost-control" type="button" onClick={() => setSelectedIds(new Set())}>
                {t("finance.treasury.invoices.clearSelection", { defaultValue: "Limpiar" })}
              </button>
            </div>
          ) : null}

          <DataTable
            getRowId={(row) => row.id}
            persistKey="treasury-invoice-inbox-v2"
            rows={filteredRows}
            controlsAddon={
              <div className="invoice-inbox-filters">
                <CompactSelect
                  className="invoice-filter-select"
                  ariaLabel={t("finance.treasury.invoices.filterUploader", { defaultValue: "Filtrar por usuario" })}
                  value={uploaderFilter}
                  onChange={setUploaderFilter}
                  options={uploaderOptions}
                />
                <CompactSelect
                  className="invoice-filter-select"
                  ariaLabel={t("finance.treasury.invoices.filterDate", { defaultValue: "Filtrar por fecha" })}
                  value={dateFilter}
                  onChange={setDateFilter}
                  options={dateOptions}
                />
                <label className="invoice-select-all">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === filteredRows.length}
                    onChange={toggleSelectAll}
                  />
                  <span>{t("finance.treasury.invoices.selectAll", { defaultValue: "Seleccionar todo" })}</span>
                </label>
              </div>
            }
            columns={[
              {
                key: "select",
                label: "",
                width: 36,
                render: (row) => (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={t("finance.treasury.invoices.selectRow", { defaultValue: "Seleccionar" })}
                  />
                ),
              },
              {
                key: "document",
                label: t("finance.treasury.invoices.columns.document", { defaultValue: "Documento" }),
                render: (row) => (
                  <span className="invoice-doc-cell">
                    {row.mimeType.includes("pdf") ? <FileText size={14} /> : <ImageIcon size={14} />}
                    <span
                      className="invoice-doc-name"
                      onClick={() => setPreview({ id: row.id, name: row.originalName })}
                      role="button"
                      title={t("finance.treasury.invoices.previewHint", { defaultValue: "Ver documento" })}
                    >
                      {row.originalName}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                label: t("finance.treasury.invoices.columns.status", { defaultValue: "Estado" }),
                render: (row) => (
                  <StatusBadge tone={statusTone(row.status)}>
                    {t(`finance.treasury.invoices.status.${row.status}`, { defaultValue: row.status })}
                  </StatusBadge>
                ),
              },
              {
                key: "supplier",
                label: t("finance.treasury.invoices.columns.supplier", { defaultValue: "Proveedor" }),
                render: (row) => row.supplierName ?? "—",
              },
              {
                key: "total",
                label: t("finance.treasury.invoices.columns.total", { defaultValue: "Total" }),
                align: "right" as const,
                render: (row) => (row.total != null ? formatMoney(row.total) : "—"),
              },
              {
                key: "invoiceDate",
                label: t("finance.treasury.invoices.columns.date", { defaultValue: "Fecha" }),
                render: (row) => row.invoiceDate ?? "—",
              },
              {
                key: "linkedUser",
                label: t("finance.treasury.invoices.columns.linkedUser", { defaultValue: "Gasto de" }),
                render: (row) => (
                  <CompactSelect
                    className="invoice-row-select"
                    ariaLabel={t("finance.treasury.invoices.columns.linkedUser", { defaultValue: "Gasto de" })}
                    value={row.linkedUserId ?? UNASSIGNED}
                    onChange={(value) => void setLinkedUser(row, value)}
                    options={memberOptions}
                  />
                ),
              },
              {
                key: "projects",
                label: t("finance.treasury.invoices.columns.projects", { defaultValue: "Proyecto" }),
                render: (row) => {
                  const isMulti = multiModeIds.has(row.id) || row.projects.length > 1;
                  if (!isMulti) {
                    const current = row.projects[0]?.projectId ?? "";
                    return (
                      <CompactSelect
                        className="invoice-row-select"
                        ariaLabel={t("finance.treasury.invoices.columns.projects", { defaultValue: "Proyecto" })}
                        value={current}
                        onChange={(value) => {
                          if (value === "__multi__") {
                            setMultiModeIds((prev) => new Set(prev).add(row.id));
                            return;
                          }
                          if (value === "") void setProjects_(row, []);
                          else void setProjects_(row, [{ projectId: value, projectName: projectName.get(value) ?? null }]);
                        }}
                        options={[
                          { value: "", label: t("finance.treasury.invoices.generalExpense", { defaultValue: "Gasto general" }) },
                          ...projects.map((project) => ({ value: project.id, label: project.name })),
                          {
                            value: "__multi__",
                            label: t("finance.treasury.invoices.multiProject", { defaultValue: "Varios proyectos…" }),
                          },
                        ]}
                      />
                    );
                  }
                  return (
                    <div className="invoice-project-chips">
                      {row.projects.map((tag) => (
                        <span className="invoice-project-chip" key={tag.projectId ?? tag.projectName ?? "?"}>
                          {tag.projectName ?? projectName.get(tag.projectId ?? "") ?? tag.projectId}
                          {tag.projectId ? (
                            <button type="button" onClick={() => removeProject(row, tag.projectId as string)}>
                              <X size={10} />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {projects.some((project) => !row.projects.some((p) => p.projectId === project.id)) ? (
                        <CompactSelect
                          className="invoice-project-add"
                          ariaLabel={t("finance.treasury.invoices.addProject", { defaultValue: "Agregar proyecto" })}
                          value=""
                          onChange={(value) => {
                            if (value) addProject(row, value);
                          }}
                          options={[
                            { value: "", label: "+" },
                            ...projects
                              .filter((project) => !row.projects.some((p) => p.projectId === project.id))
                              .map((project) => ({ value: project.id, label: project.name })),
                          ]}
                        />
                      ) : null}
                    </div>
                  );
                },
              },
              {
                key: "uploadedBy",
                label: t("finance.treasury.invoices.columns.uploadedBy", { defaultValue: "Subido por" }),
                render: (row) => (
                  <div className="cell-stack">
                    <span>
                      {row.uploadedByName ??
                        t("finance.treasury.invoices.unknownUploader", { defaultValue: "Sin usuario" })}
                    </span>
                    <small className="text-muted">{row.createdAt.slice(0, 10)}</small>
                  </div>
                ),
              },
              {
                key: "match",
                label: t("finance.treasury.invoices.columns.match", { defaultValue: "Movimiento sugerido" }),
                render: (row) =>
                  row.status === "applied" && row.appliedTransactionId
                    ? txnLabel.get(row.appliedTransactionId) ?? t("finance.treasury.invoices.applied", { defaultValue: "Aplicado" })
                    : row.suggestedTransactionId
                      ? `${txnLabel.get(row.suggestedTransactionId) ?? row.suggestedTransactionId}${
                          row.matchConfidence != null ? ` (${Math.round(row.matchConfidence * 100)}%)` : ""
                        }`
                      : row.status === "failed"
                        ? row.errorMessage ?? "—"
                        : "—",
              },
              {
                key: "actions",
                label: t("finance.treasury.invoices.columns.actions", { defaultValue: "Acciones" }),
                render: (row) => (
                  <span className="invoice-actions-cell">
                    <button
                      type="button"
                      className="ghost-control action-row-button"
                      onClick={() => setEditing(row)}
                      title={t("finance.treasury.invoices.edit", { defaultValue: "Editar" })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="action-primary-button action-row-button"
                      disabled={
                        busyId === row.id ||
                        row.status === "applied" ||
                        row.status === "dismissed" ||
                        !row.suggestedTransactionId
                      }
                      onClick={() => void apply(row)}
                    >
                      <Check size={14} />
                      {t("finance.treasury.invoices.apply", { defaultValue: "Aplicar" })}
                    </button>
                    <button
                      type="button"
                      className="ghost-control action-row-button"
                      disabled={busyId === row.id || row.status === "applied" || row.status === "dismissed"}
                      onClick={() => void dismiss(row)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                ),
              },
            ]}
          />
        </>
      )}

      <DocumentPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ""}
        dataUrl={previewData?.dataUrl ?? null}
        mimeType={previewData?.mimeType ?? null}
        isLoading={previewLoading}
        loadingLabel={t("finance.treasury.invoices.previewLoading", { defaultValue: "Cargando documento…" })}
      />

      {editing ? (
        <InvoiceEditModal
          extraction={editing}
          categories={expenseCategories}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            try {
              await mutations.updateInvoiceExtraction({ workspaceId, extractionId: editing.id, ...patch });
              toast.success(t("finance.treasury.invoices.editSaved", { defaultValue: "Factura actualizada." }));
              setEditing(null);
              inbox.refresh();
            } catch (error) {
              toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.editFailed", { defaultValue: "No se pudo guardar." })));
            }
          }}
        />
      ) : null}
    </SurfaceCard>
  );
};

/* ------------------------------------------------------------------------- */
/* Manual edit modal                                                         */
/* ------------------------------------------------------------------------- */

type EditPatch = Pick<
  UpdateInvoiceExtractionCommand,
  "supplierName" | "supplierRnc" | "ncf" | "invoiceDate" | "subtotal" | "itbis" | "total" | "currency" | "expenseCategory"
>;

const InvoiceEditModal = ({
  extraction,
  categories,
  onClose,
  onSave,
}: {
  extraction: InvoiceExtraction;
  categories: string[];
  onClose: () => void;
  onSave: (patch: EditPatch) => void;
}) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    supplierName: extraction.supplierName ?? "",
    supplierRnc: extraction.supplierRnc ?? "",
    ncf: extraction.ncf ?? "",
    invoiceDate: extraction.invoiceDate ?? "",
    subtotal: extraction.subtotal != null ? String(extraction.subtotal) : "",
    itbis: extraction.itbis != null ? String(extraction.itbis) : "",
    total: extraction.total != null ? String(extraction.total) : "",
    currency: extraction.currency ?? "DOP",
    expenseCategory: extraction.expenseCategory ?? "",
  });

  const num = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const fields: Array<{ key: keyof typeof form; label: string; numeric?: boolean }> = [
    { key: "supplierName", label: t("finance.treasury.invoices.columns.supplier", { defaultValue: "Proveedor" }) },
    { key: "supplierRnc", label: t("finance.treasury.invoices.rnc", { defaultValue: "RNC" }) },
    { key: "ncf", label: t("finance.treasury.invoices.columns.ncf", { defaultValue: "NCF" }) },
    { key: "invoiceDate", label: t("finance.treasury.invoices.columns.date", { defaultValue: "Fecha" }) },
    { key: "subtotal", label: t("finance.treasury.invoices.subtotal", { defaultValue: "Subtotal" }), numeric: true },
    { key: "itbis", label: t("finance.treasury.invoices.columns.itbis", { defaultValue: "ITBIS" }), numeric: true },
    { key: "total", label: t("finance.treasury.invoices.columns.total", { defaultValue: "Total" }), numeric: true },
    { key: "currency", label: t("finance.treasury.invoices.currency", { defaultValue: "Moneda" }) },
    { key: "expenseCategory", label: t("finance.treasury.invoices.columns.category", { defaultValue: "Categoría" }) },
  ];

  return createPortal(
    <div className="document-preview-backdrop" onClick={onClose} role="presentation">
      <div
        className="document-preview-dialog"
        style={{ width: "min(620px, 92vw)" }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="document-preview-header">
          <span className="document-preview-title">
            {t("finance.treasury.invoices.editTitle", { defaultValue: "Editar factura" })}
          </span>
          <button className="icon-ghost-control" onClick={onClose} type="button" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="document-preview-body" style={{ display: "block" }}>
          <div className="invoice-edit-grid">
            {fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.key === "expenseCategory" ? (
                  <CreatableSelect
                    ariaLabel={field.label}
                    value={form.expenseCategory || null}
                    options={categories}
                    placeholder={t("finance.treasury.invoices.noCategory", { defaultValue: "Sin categoría" })}
                    createLabel={(q) => t("finance.treasury.invoices.createCategory", { defaultValue: `Crear "${q}"`, query: q })}
                    onChange={(next) => setForm((prev) => ({ ...prev, expenseCategory: next }))}
                  />
                ) : (
                  <input
                    className="field-input"
                    inputMode={field.numeric ? "decimal" : undefined}
                    value={form[field.key]}
                    onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
        <div className="document-preview-header" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--hairline-faint, rgba(255,255,255,0.05))", borderBottom: 0 }}>
          <button className="ghost-control" type="button" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Cancelar" })}
          </button>
          <button
            className="action-primary-button"
            type="button"
            onClick={() =>
              onSave({
                supplierName: form.supplierName.trim() || null,
                supplierRnc: form.supplierRnc.trim() || null,
                ncf: form.ncf.trim() || null,
                invoiceDate: form.invoiceDate.trim() || null,
                subtotal: num(form.subtotal),
                itbis: num(form.itbis),
                total: num(form.total),
                currency: form.currency.trim().toUpperCase() || null,
                expenseCategory: form.expenseCategory.trim() || null,
              })
            }
          >
            {t("common.save", { defaultValue: "Guardar" })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
