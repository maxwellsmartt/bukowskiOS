import { Check, FileText, Image as ImageIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { InvoiceExtraction, InvoiceInboxFileInput } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { CompactSelect } from "@shared/components/CompactSelect";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { StatusBadge } from "@shared/components/StatusBadge";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { useInvoiceInbox, useTreasuryTransactions, useTreasuryMutations } from "./useTreasuryData";

const ACCEPTED = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_FILES = 60;
const MAX_BYTES = 15 * 1024 * 1024;

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

type Props = {
  workspaceId: string;
  formatMoney: (value: number) => string;
};

export const InvoiceInboxPanel = ({ workspaceId, formatMoney }: Props) => {
  const { t } = useTranslation();
  const { user } = useSession();
  const inbox = useInvoiceInbox(workspaceId);
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
        <div className="invoice-inbox-filters">
          <CompactSelect
            ariaLabel={t("finance.treasury.invoices.filterUploader", { defaultValue: "Filtrar por usuario" })}
            value={uploaderFilter}
            onChange={setUploaderFilter}
            options={uploaderOptions}
          />
          <CompactSelect
            ariaLabel={t("finance.treasury.invoices.filterDate", { defaultValue: "Filtrar por fecha" })}
            value={dateFilter}
            onChange={setDateFilter}
            options={dateOptions}
          />
        </div>
        <DataTable
          getRowId={(row) => row.id}
          persistKey="treasury-invoice-inbox-v1"
          rows={filteredRows}
          columns={[
            {
              key: "document",
              label: t("finance.treasury.invoices.columns.document", { defaultValue: "Documento" }),
              render: (row) => (
                <span className="invoice-doc-cell">
                  {row.mimeType.includes("pdf") ? <FileText size={14} /> : <ImageIcon size={14} />}
                  <span className="invoice-doc-name">{row.originalName}</span>
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
              key: "ncf",
              label: t("finance.treasury.invoices.columns.ncf", { defaultValue: "NCF" }),
              render: (row) => row.ncf ?? "—",
            },
            {
              key: "invoiceDate",
              label: t("finance.treasury.invoices.columns.date", { defaultValue: "Fecha" }),
              render: (row) => row.invoiceDate ?? "—",
            },
            {
              key: "total",
              label: t("finance.treasury.invoices.columns.total", { defaultValue: "Total" }),
              align: "right" as const,
              render: (row) => (row.total != null ? formatMoney(row.total) : "—"),
            },
            {
              key: "itbis",
              label: t("finance.treasury.invoices.columns.itbis", { defaultValue: "ITBIS" }),
              align: "right" as const,
              render: (row) => (row.itbis != null ? formatMoney(row.itbis) : "—"),
            },
            {
              key: "category",
              label: t("finance.treasury.invoices.columns.category", { defaultValue: "Categoría" }),
              render: (row) => row.expenseCategory ?? "—",
            },
            {
              key: "uploadedBy",
              label: t("finance.treasury.invoices.columns.uploadedBy", { defaultValue: "Subido por" }),
              render: (row) =>
                row.uploadedByName ?? t("finance.treasury.invoices.unknownUploader", { defaultValue: "Sin usuario" }),
            },
            {
              key: "uploadedOn",
              label: t("finance.treasury.invoices.columns.uploadedOn", { defaultValue: "Subido el" }),
              render: (row) => row.createdAt.slice(0, 10),
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
    </SurfaceCard>
  );
};
