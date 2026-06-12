import { AlertCircle, ArrowRightLeft, BadgeCheck, Check, CheckCircle2, Clock, Download, FileText, Image as ImageIcon, Loader2, Pencil, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  InvoiceDuplicateGroup,
  InvoiceExtractionAllocation,
  InvoiceExtraction,
  InvoiceExtractionProjectInput,
  InvoiceInboxFileInput,
  BankTransactionRow,
  UpdateInvoiceExtractionCommand,
} from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { CompactSelect, type CompactSelectOption } from "@shared/components/CompactSelect";
import { CreatableSelect } from "@shared/components/CreatableSelect";
import { DataTable } from "@shared/components/DataTable";
import { DocumentPreviewModal } from "@shared/components/DocumentPreviewModal";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ModalShell } from "@shared/components/ModalShell";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { StatusBadge } from "@shared/components/StatusBadge";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { useCatalogData } from "@features/projects/useProjectsData";

import {
  useExpenseCategories,
  useBankAccounts,
  useInvoiceDuplicates,
  useInvoiceInbox,
  useTreasuryTransactions,
  useTreasuryMutations,
  useTreasuryReimbursements,
} from "./useTreasuryData";

const ACCEPTED = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_FILES = 60;
const MAX_BYTES = 15 * 1024 * 1024;
const UNASSIGNED = "__unassigned__";
const GENERAL_PROJECT = "__general_project__";
const currencyOptions = [
  { value: "DOP", label: "DOP" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

const formatInvoiceMoney = (value: number, currency: string | null | undefined) =>
  `${(currency ?? "DOP").toUpperCase()} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const csvEscape = (value: string | number | null | undefined) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

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

type PendingFxRatePrompt = {
  title: string;
  body: string;
  fromCurrency: string;
  toCurrency: string;
  defaultRate?: number | null;
  onConfirm: (rate: number) => Promise<void>;
};

const statusTone = (status: InvoiceExtraction["status"]): "neutral" | "info" | "success" | "warning" | "critical" => {
  switch (status) {
    case "extracted":
    case "applied":
      return "success";
    case "failed":
      return "critical";
    case "pending":
    case "processing":
      return "warning";
    default:
      return "neutral";
  }
};

const statusIcon = (status: InvoiceExtraction["status"]): { icon: LucideIcon; spin: boolean } => {
  switch (status) {
    case "extracted":
      return { icon: Check, spin: false };
    case "applied":
      return { icon: CheckCircle2, spin: false };
    case "failed":
      return { icon: AlertCircle, spin: false };
    case "processing":
      return { icon: Loader2, spin: true };
    case "pending":
      return { icon: Clock, spin: false };
    default:
      return { icon: Clock, spin: false };
  }
};

type Project = { id: string; name: string };
type ReconciliationCandidate = {
  row: BankTransactionRow;
  score: number;
  reasons: string[];
};

type Props = {
  workspaceId: string;
  formatMoney: (value: number) => string;
  onOpenMovement?: (transactionId: string) => void;
};

export const InvoiceInboxPanel = ({ workspaceId, formatMoney, onOpenMovement }: Props) => {
  const { t } = useTranslation();
  const { user } = useSession();
  const { createNotification } = useNotifications();
  const inbox = useInvoiceInbox(workspaceId);
  const expenseCategories = useExpenseCategories(workspaceId);
  const accounts = useBankAccounts(workspaceId);
  const duplicates = useInvoiceDuplicates(workspaceId);
  const catalog = useCatalogData({ workspaceId, entityType: "crew", search: "", sortBy: "fullName", sortDirection: "asc" });
  const [showDuplicates, setShowDuplicates] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const mutations = useTreasuryMutations();
  const transactions = useTreasuryTransactions(
    useMemo(() => ({ workspaceId, limit: 1000 }), [workspaceId]),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isBulkDismissing, setIsBulkDismissing] = useState(false);
  const [isBulkRetrying, setIsBulkRetrying] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isBulkAssigningInstrument, setIsBulkAssigningInstrument] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploaderFilter, setUploaderFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [reimbursementOwnerFilter, setReimbursementOwnerFilter] = useState<string>("all");
  const [reimbursementInstrumentFilter, setReimbursementInstrumentFilter] = useState<string>("all");
  const [reimbursementStatusFilter, setReimbursementStatusFilter] = useState<string>("open");
  const [reimbursementCycleStartFilter, setReimbursementCycleStartFilter] = useState<string>("");
  const [reimbursementCycleEndFilter, setReimbursementCycleEndFilter] = useState<string>("");
  const [showReimbursements, setShowReimbursements] = useState(false);
  const [expandedReimbursementKeys, setExpandedReimbursementKeys] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [optimisticAllocations, setOptimisticAllocations] = useState<Map<string, InvoiceExtractionAllocation>>(new Map());
  // Rows the user explicitly switched to multi-project mode (chips). By
  // default an invoice is assigned to a single project.
  const [multiModeIds, setMultiModeIds] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<InvoiceExtraction | null>(null);
  const [reconciling, setReconciling] = useState<InvoiceExtraction | null>(null);
  const [pendingFxRatePrompt, setPendingFxRatePrompt] = useState<PendingFxRatePrompt | null>(null);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [previewData, setPreviewData] = useState<{ dataUrl: string; mimeType: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const reimbursementQuery = useMemo(
    () => ({
      workspaceId,
      ownerUserId: reimbursementOwnerFilter === "all" ? null : reimbursementOwnerFilter,
      paymentInstrumentId: reimbursementInstrumentFilter === "all" ? null : reimbursementInstrumentFilter,
      status: reimbursementStatusFilter as "open" | "all" | "pending" | "matched" | "partial" | "rejected" | "reimbursed",
      cycleStart: reimbursementCycleStartFilter || null,
      cycleEnd: reimbursementCycleEndFilter || null,
    }),
    [
      reimbursementCycleEndFilter,
      reimbursementCycleStartFilter,
      reimbursementInstrumentFilter,
      reimbursementOwnerFilter,
      reimbursementStatusFilter,
      workspaceId,
    ],
  );
  const reimbursements = useTreasuryReimbursements(reimbursementQuery);

  // Projects for project tags. "Gasto de" is sourced from catalog crew below.
  useEffect(() => {
    let cancelled = false;
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

  const txnAccountLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of transactions.data) {
      const account = accounts.data.find((item) => item.id === row.bankAccountId);
      const terminal = account?.last4 || account?.accountNumberMasked?.match(/(\d{4})\D*$/)?.[1] || null;
      map.set(row.id, account ? `${account.accountLabel}${terminal ? ` · •••• ${terminal}` : ""} · ${account.currency}` : row.bankAccountLabel);
    }
    return map;
  }, [accounts.data, transactions.data]);
  const paymentInstrumentLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts.data) {
      const terminal = account.last4 || account.accountNumberMasked?.match(/(\d{4})\D*$/)?.[1] || null;
      map.set(account.id, `${account.accountLabel}${terminal ? ` · •••• ${terminal}` : ""} · ${account.currency}`);
    }
    return map;
  }, [accounts.data]);
  const paymentInstrumentLabelByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts.data) {
      const terminal = account.last4 || account.accountNumberMasked?.match(/(\d{4})\D*$/)?.[1] || null;
      map.set(account.accountLabel, `${account.accountLabel}${terminal ? ` · •••• ${terminal}` : ""} · ${account.currency}`);
    }
    return map;
  }, [accounts.data]);
  const renderPaymentInstrumentLabel = (label: string | null | undefined) => {
    if (!label) return "—";
    const parts = /^(.*?)( · •••• \d{4})(.*)$/.exec(label);
    if (!parts) return label;
    return (
      <span>
        {parts[1]}
        <span className="treasury-account-terminal">{parts[2]}</span>
        {parts[3]}
      </span>
    );
  };
  const accountById = useMemo(() => {
    const map = new Map<string, (typeof accounts.data)[number]>();
    for (const account of accounts.data) map.set(account.id, account);
    return map;
  }, [accounts.data]);
  const buildPaymentInstrumentOptions = (
    currency: string | null | undefined,
    placeholder: string,
  ): Array<CompactSelectOption<string>> => {
    const normalizedCurrency = currency?.toUpperCase() ?? null;
    return [
      { value: "", label: placeholder },
      ...accounts.data
        .filter((account) => account.isActive)
        .filter((account) => !normalizedCurrency || account.currency.toUpperCase() === normalizedCurrency)
        .map((account) => ({
          value: account.id,
          label: paymentInstrumentLabel.get(account.id) ?? `${account.accountLabel} · ${account.currency}`,
        })),
    ];
  };

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
      ...catalog.data.crewMembers
        .filter((crew) => crew.isActive)
        .map((crew) => ({
          value: crew.id,
          label: crew.roleLabel ? `${crew.fullName} · ${crew.roleLabel}` : crew.fullName,
        })),
    ],
    [catalog.data.crewMembers, t],
  );

  const reimbursementOwnerOptions = useMemo(
    () => {
      const options = [
        { value: "all", label: t("finance.treasury.invoices.reimbursements.allOwners", { defaultValue: "Todos los responsables" }) },
        ...memberOptions,
      ];
      for (const group of reimbursements.data?.groups ?? []) {
        if (group.ownerUserId && !options.some((option) => option.value === group.ownerUserId)) {
          options.push({ value: group.ownerUserId, label: group.ownerName });
        }
      }
      return options;
    },
    [memberOptions, reimbursements.data?.groups, t],
  );
  const reimbursementInstrumentOptions = useMemo(
    () => [
      { value: "all", label: t("finance.treasury.invoices.reimbursements.allInstruments", { defaultValue: "Todos los medios" }) },
      ...accounts.data
        .filter((account) => account.isActive)
        .map((account) => ({
          value: account.id,
          label: paymentInstrumentLabel.get(account.id) ?? `${account.accountLabel} · ${account.currency}`,
        })),
    ],
    [accounts.data, paymentInstrumentLabel, t],
  );
  const reimbursementStatusOptions = useMemo(
    () => [
      { value: "open", label: t("finance.treasury.invoices.reimbursements.status.open", { defaultValue: "Abiertos" }) },
      { value: "pending", label: t("finance.treasury.invoices.reimbursements.status.pending", { defaultValue: "Pendientes" }) },
      { value: "matched", label: t("finance.treasury.invoices.reimbursements.status.matched", { defaultValue: "Conciliados" }) },
      { value: "partial", label: t("finance.treasury.invoices.reimbursements.status.partial", { defaultValue: "Parciales" }) },
      { value: "reimbursed", label: t("finance.treasury.invoices.reimbursements.status.reimbursed", { defaultValue: "Reembolsados" }) },
      { value: "rejected", label: t("finance.treasury.invoices.reimbursements.status.rejected", { defaultValue: "Rechazados" }) },
      { value: "all", label: t("finance.treasury.invoices.reimbursements.status.all", { defaultValue: "Todos" }) },
    ],
    [t],
  );

  useEffect(() => {
    setExpandedReimbursementKeys(new Set());
  }, [reimbursementQuery]);

  const filteredRows = useMemo(() => {
    return inbox.data.filter((row) => {
      const uploaderKey = row.uploadedByUserId ?? row.uploadedByName ?? "unknown";
      const matchUploader = uploaderFilter === "all" || uploaderKey === uploaderFilter;
      const matchDate = dateFilter === "all" || row.createdAt.slice(0, 10) === dateFilter;
      return matchUploader && matchDate;
    });
  }, [inbox.data, uploaderFilter, dateFilter]);
  const invoiceRowsById = useMemo(
    () => new Map(inbox.data.map((row) => [row.id, row])),
    [inbox.data],
  );
  useEffect(() => {
    setOptimisticAllocations((current) => {
      if (!current.size) return current;
      const next = new Map(current);
      for (const row of inbox.data) {
        const optimistic = next.get(row.id);
        if (optimistic && row.allocation?.paymentInstrumentId === optimistic.paymentInstrumentId) {
          next.delete(row.id);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [inbox.data]);
  const selectedRowIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedIds.has(row.id)),
    [filteredRows, selectedIds],
  );
  const selectedCurrency = useMemo(() => {
    const currencies = new Set(
      selectedRows
        .map((row) => row.currency?.toUpperCase() ?? null)
        .filter((currency): currency is string => Boolean(currency)),
    );
    return currencies.size === 1 ? Array.from(currencies)[0] : null;
  }, [selectedRows]);
  const bulkPaymentInstrumentOptions = useMemo(
    () =>
      buildPaymentInstrumentOptions(
        selectedCurrency,
        selectedCurrency
          ? t("finance.treasury.invoices.choosePaymentInstrumentForCurrency", {
              defaultValue: "Asignar medio de pago {{currency}}...",
              currency: selectedCurrency,
            })
          : t("finance.treasury.invoices.choosePaymentInstrument", { defaultValue: "Asignar medio de pago..." }),
      ),
    [accounts.data, paymentInstrumentLabel, selectedCurrency, t],
  );
  const editingPaymentInstrumentOptions = useMemo(
    () =>
      buildPaymentInstrumentOptions(
        editing?.currency ?? null,
        editing?.currency
          ? t("finance.treasury.invoices.choosePaymentInstrumentForCurrency", {
              defaultValue: "Asignar medio de pago {{currency}}...",
              currency: editing.currency.toUpperCase(),
            })
          : t("finance.treasury.invoices.choosePaymentInstrument", { defaultValue: "Asignar medio de pago..." }),
      ),
    [accounts.data, editing?.currency, paymentInstrumentLabel, t],
  );
  const retryableSelectedRows = useMemo(
    () => selectedRows.filter((row) => row.status !== "processing" && row.status !== "applied" && row.status !== "dismissed"),
    [selectedRows],
  );
  const reimbursementGroups = useMemo(
    () =>
      (reimbursements.data?.groups ?? []).map((group) => ({
        key: group.key,
        owner: group.ownerName,
        instrument: group.paymentInstrumentLabel,
        status: group.status,
        cycle:
          group.cycleStart && group.cycleEnd
            ? `${group.cycleStart} → ${group.cycleEnd}`
            : t("finance.treasury.invoices.noCycle", { defaultValue: "Sin ciclo" }),
        currency: group.currency,
        amount: group.amount,
        count: group.invoiceCount,
        latestUpdatedAt: group.latestUpdatedAt,
        items: group.items,
      })),
    [reimbursements.data?.groups, t],
  );
  const hasActiveReimbursementFilters =
    reimbursementOwnerFilter !== "all" ||
    reimbursementInstrumentFilter !== "all" ||
    reimbursementStatusFilter !== "open" ||
    Boolean(reimbursementCycleStartFilter) ||
    Boolean(reimbursementCycleEndFilter);
  const reimbursementTotals = reimbursements.data?.totalsByCurrency ?? [];
  const reimbursementExportRows = useMemo(
    () =>
      reimbursementGroups.flatMap((group) =>
        group.items.map((item) => ({
          responsable: group.owner,
          medio: group.instrument,
          ciclo: group.cycle,
          estadoGrupo: group.status,
          factura: item.originalName,
          proveedor: item.supplierName ?? "",
          rnc: item.supplierRnc ?? "",
          ncf: item.ncf ?? "",
          fecha: item.invoiceDate ?? "",
          monto: item.amount,
          moneda: item.currency,
          estado: item.status,
          movimiento: item.transactionLabel ?? "",
          transactionId: item.transactionId ?? "",
          allocationId: item.allocationId,
        })),
      ),
    [reimbursementGroups],
  );

  const exportReimbursements = async (format: "csv" | "xlsx") => {
    if (!reimbursementExportRows.length) {
      toast.info(t("finance.treasury.invoices.reimbursements.exportEmpty", { defaultValue: "No hay reembolsos filtrados para exportar." }));
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `bukowski-reembolsos-${stamp}.${format}`;
    if (format === "csv") {
      const headers = Object.keys(reimbursementExportRows[0]);
      const csv = [
        headers.map(csvEscape).join(","),
        ...reimbursementExportRows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(",")),
      ].join("\n");
      downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), filename);
      return;
    }
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(reimbursementExportRows);
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1")) };
    XLSX.utils.book_append_sheet(workbook, sheet, "Reembolsos");
    const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    downloadBlob(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
  };

  const reconciliationCandidates = useMemo(() => {
    if (!reconciling) return [];
    const invoiceTotal = reconciling.total ?? 0;
    const invoiceTime = reconciling.invoiceDate ? Date.parse(reconciling.invoiceDate) : Number.NaN;
    const supplier = (reconciling.supplierName ?? "").trim().toLowerCase();
    return transactions.data
      .filter((row) => row.direction === "debit")
      .map((row): ReconciliationCandidate => {
        const reasons: string[] = [];
        let score = 0;
        if (invoiceTotal > 0) {
          const diff = Math.abs(row.amount - invoiceTotal);
          const tolerance = Math.max(1, invoiceTotal * 0.03);
          if (diff <= tolerance) {
            score += 45 * (1 - Math.min(1, diff / tolerance));
            reasons.push(t("finance.treasury.invoices.reconcile.reasonAmount", { defaultValue: "monto cercano" }));
          }
        }
        if (!Number.isNaN(invoiceTime)) {
          const txnTime = Date.parse(row.txnDate);
          if (!Number.isNaN(txnTime)) {
            const days = Math.abs(txnTime - invoiceTime) / 86_400_000;
            if (days <= 14) {
              score += 25 * (1 - days / 14);
              reasons.push(t("finance.treasury.invoices.reconcile.reasonDate", { defaultValue: "fecha cercana" }));
            }
          }
        }
        if (reconciling.allocation?.paymentInstrumentId && row.bankAccountId === reconciling.allocation.paymentInstrumentId) {
          score += 20;
          reasons.push(t("finance.treasury.invoices.reconcile.reasonInstrument", { defaultValue: "mismo medio" }));
        }
        if (supplier && (row.rawDescription ?? "").toLowerCase().includes(supplier.slice(0, Math.min(8, supplier.length)))) {
          score += 10;
          reasons.push(t("finance.treasury.invoices.reconcile.reasonSupplier", { defaultValue: "proveedor en descripción" }));
        }
        if (row.id === reconciling.suggestedTransactionId) {
          score += 18;
          reasons.unshift(t("finance.treasury.invoices.reconcile.reasonSuggested", { defaultValue: "sugerido por el sistema" }));
        }
        return { row, score: Math.round(score), reasons };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [reconciling, t, transactions.data]);

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
      await createNotification({
        kind: "invoice_inbox",
        title: t("finance.treasury.invoices.notifications.uploadedTitle", { defaultValue: "Facturas subidas" }),
        body: t("finance.treasury.invoices.notifications.uploadedBody", {
          defaultValue: "{{count}} factura(s) listas para procesar en Tesorería.",
          count: result.queuedCount,
        }),
        linkTo: "/finance/treasury",
        sourceType: "invoice_inbox",
        sourceRef: { batchId: result.batchId, queuedCount: result.queuedCount, skippedCount: result.skippedCount },
        notifyNow: true,
      });
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

  const applySelectedSuggested = async () => {
    const rowsToApply = selectedRows.filter(
      (row) => row.suggestedTransactionId && row.status !== "applied" && row.status !== "dismissed",
    );
    const skippedCount = selectedRows.length - rowsToApply.length;
    if (!rowsToApply.length) {
      toast.info(
        t("finance.treasury.invoices.batchApplyNone", {
          defaultValue: "No hay facturas seleccionadas con movimiento sugerido aplicable.",
        }),
      );
      return;
    }
    setIsBulkRetrying(true);
    try {
      let appliedCount = 0;
      let failedCount = 0;
      for (const row of rowsToApply) {
        try {
          await mutations.applyInvoiceExtraction({
            workspaceId,
            extractionId: row.id,
            transactionId: row.suggestedTransactionId as string,
          });
          appliedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      if (!appliedCount) {
        toast.error(t("finance.treasury.invoices.batchApplyFailed", { defaultValue: "No se pudo aplicar ninguna factura seleccionada." }));
        return;
      }
      toast.success(
        t("finance.treasury.invoices.batchApplied", {
          defaultValue: "{{count}} factura(s) aplicada(s).",
          count: appliedCount,
        }),
        skippedCount || failedCount
          ? {
              description: t("finance.treasury.invoices.batchAppliedSkipped", {
                defaultValue: "{{count}} factura(s) se omitieron por no tener sugerencia o por error.",
                count: skippedCount + failedCount,
              }),
            }
          : undefined,
      );
      setSelectedIds(new Set());
      inbox.refresh();
    } finally {
      setIsBulkRetrying(false);
    }
  };

  const dismiss = async (row: InvoiceExtraction) => {
    const confirmed = await confirm({
      title: t("finance.treasury.invoices.dismissConfirmTitle", { defaultValue: "¿Descartar esta factura?" }),
      body: t("finance.treasury.invoices.dismissConfirmBody", {
        defaultValue: "La factura saldrá de la bandeja. Esta acción no se puede deshacer.",
      }),
      confirmLabel: t("finance.treasury.invoices.dismissConfirmAction", { defaultValue: "Descartar" }),
    });
    if (!confirmed) return;
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

  const downloadOne = async (row: InvoiceExtraction) => {
    setBusyId(row.id);
    try {
      const result = await mutations.downloadInvoiceDocument(workspaceId, row.id);
      if (result.saved) toast.success(result.summary);
      else if (result.summary && !/cancel/i.test(result.summary)) toast.error(result.summary);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.downloadFailed", { defaultValue: "No se pudo descargar la factura." })));
    } finally {
      setBusyId(null);
    }
  };

  const downloadSelected = async () => {
    const ids = selectedRowIdList;
    if (!ids.length) return;
    setIsBulkDownloading(true);
    try {
      const result =
        ids.length === 1
          ? await mutations.downloadInvoiceDocument(workspaceId, ids[0])
          : await mutations.downloadInvoiceBatch(workspaceId, ids);
      if (result.saved) toast.success(result.summary);
      else if (result.summary && !/cancel/i.test(result.summary)) toast.error(result.summary);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.downloadFailed", { defaultValue: "No se pudieron descargar las facturas." })));
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const resolveDuplicates = async (idsToDismiss: string[]) => {
    try {
      for (const id of idsToDismiss) {
        await mutations.dismissInvoiceExtraction({ workspaceId, extractionId: id });
      }
      toast.success(
        t("finance.treasury.invoices.duplicates.resolved", {
          defaultValue: "Duplicados resueltos.",
        }),
      );
      setShowDuplicates(false);
      duplicates.refresh();
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.duplicates.failed", { defaultValue: "No se pudieron resolver los duplicados." })));
    }
  };

  const setLinkedUser = async (row: InvoiceExtraction, value: string) => {
    const member = catalog.data.crewMembers.find((m) => m.id === value);
    try {
      await mutations.updateInvoiceExtraction({
        workspaceId,
        extractionId: row.id,
        linkedUserId: value === UNASSIGNED ? null : value,
        linkedUserName: value === UNASSIGNED ? null : member?.fullName ?? null,
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

  const setCurrency = async (row: InvoiceExtraction, currency: string) => {
    try {
      await mutations.updateInvoiceExtraction({ workspaceId, extractionId: row.id, currency });
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.currencyFailed", { defaultValue: "No se pudo guardar la moneda." })));
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

  const bulkAssignUser = async (value: string) => {
    if (!value) return;
    const member = catalog.data.crewMembers.find((m) => m.id === value);
    try {
      const result = await mutations.bulkLinkInvoices({
        workspaceId,
        extractionIds: Array.from(selectedIds),
        linkedUserId: value === UNASSIGNED ? null : value,
        linkedUserName: value === UNASSIGNED ? null : member?.fullName ?? null,
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.linkFailed", { defaultValue: "No se pudo vincular el usuario." })));
    }
  };

  const bulkDismissSelected = async () => {
    const dismissableRows = selectedRows.filter((row) => row.status !== "applied" && row.status !== "dismissed");
    const skippedCount = selectedRows.length - dismissableRows.length;

    if (!dismissableRows.length) {
      toast.info(
        t("finance.treasury.invoices.batchDismissNone", {
          defaultValue: "No hay facturas seleccionadas que se puedan descartar.",
        }),
      );
      return;
    }

    const confirmed = await confirm({
      title: t("finance.treasury.invoices.batchDismissConfirmTitle", {
        defaultValue: "¿Borrar facturas seleccionadas de la bandeja?",
      }),
      body: t("finance.treasury.invoices.batchDismissConfirmBody", {
        defaultValue:
          "Las facturas seleccionadas saldrán de la bandeja, pero quedarán en el historial local y en sync. Esta acción no borra archivos de forma destructiva.",
        count: dismissableRows.length,
      }),
      details:
        skippedCount > 0
          ? t("finance.treasury.invoices.batchDismissSkipped", {
              defaultValue: "{{count}} factura(s) aplicada(s) o ya descartada(s) se omitirán.",
              count: skippedCount,
            })
          : undefined,
      confirmLabel: t("finance.treasury.invoices.batchDismissAction", {
        defaultValue: "Borrar {{count}}",
        count: dismissableRows.length,
      }),
      cancelLabel: t("common.cancel", { defaultValue: "Cancelar" }),
    });
    if (!confirmed) return;

    setIsBulkDismissing(true);
    try {
      for (const row of dismissableRows) {
        await mutations.dismissInvoiceExtraction({ workspaceId, extractionId: row.id });
      }
      toast.success(
        t("finance.treasury.invoices.batchDismissed", {
          defaultValue: "{{count}} factura(s) descartada(s).",
          count: dismissableRows.length,
        }),
      );
      setSelectedIds(new Set());
      inbox.refresh();
      reimbursements.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.dismissFailed", { defaultValue: "No se pudo descartar." })));
    } finally {
      setIsBulkDismissing(false);
    }
  };

  const bulkMarkReimbursedSelected = async () => {
    const rowsToReimburse = selectedRows.filter(
      (row) => row.status !== "dismissed" && row.allocation?.id && row.allocation.allocationStatus !== "reimbursed",
    );
    const skippedCount = selectedRows.length - rowsToReimburse.length;
    if (!rowsToReimburse.length) {
      toast.info(
        t("finance.treasury.invoices.batchReimbursedNone", {
          defaultValue: "No hay facturas seleccionadas con reembolso abierto.",
        }),
      );
      return;
    }
    setIsBulkDismissing(true);
    try {
      let reimbursedCount = 0;
      let failedCount = 0;
      for (const row of rowsToReimburse) {
        try {
          await mutations.markInvoiceAllocationReimbursed({
            commandId: `invoice-allocation-reimbursed-${row.allocation?.id}`,
            workspaceId,
            actorType: "user",
            sourceChannel: "desktop",
            allocationId: row.allocation?.id as string,
          });
          reimbursedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      if (!reimbursedCount) {
        toast.error(t("finance.treasury.invoices.batchReimbursedFailed", { defaultValue: "No se pudo marcar ninguna factura como reembolsada." }));
        return;
      }
      toast.success(
        t("finance.treasury.invoices.batchReimbursed", {
          defaultValue: "{{count}} factura(s) marcada(s) como reembolsada(s).",
          count: reimbursedCount,
        }),
        skippedCount || failedCount
          ? {
              description: t("finance.treasury.invoices.batchReimbursedSkipped", {
                defaultValue: "{{count}} factura(s) se omitieron porque no aplicaban o fallaron.",
                count: skippedCount + failedCount,
              }),
            }
          : undefined,
      );
      setSelectedIds(new Set());
      inbox.refresh();
      reimbursements.refresh();
    } finally {
      setIsBulkDismissing(false);
    }
  };

  const bulkSetProject = async (projectId: string) => {
    if (!projectId) return;
    const projectsPayload =
      projectId === GENERAL_PROJECT ? [] : [{ projectId, projectName: projectName.get(projectId) ?? null }];
    try {
      const result = await mutations.bulkLinkInvoices({
        workspaceId,
        extractionIds: Array.from(selectedIds),
        projects: projectsPayload,
      });
      toast.success(result.summary);
      inbox.refresh();
      reimbursements.refresh();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, t("finance.treasury.invoices.projectFailed", { defaultValue: "No se pudieron guardar los proyectos." })));
    }
  };

  const bulkAssignPaymentInstrumentWithRate = async (paymentInstrumentId: string, fxRate: number | null = null) => {
    if (!paymentInstrumentId) return;
    const instrument = accountById.get(paymentInstrumentId);
    if (!instrument) {
      toast.error(t("finance.treasury.invoices.paymentInstrumentMissing", { defaultValue: "Ese medio de pago ya no está disponible." }));
      return;
    }
    const instrumentCurrency = instrument.currency.toUpperCase();
    const selectedIdSet = new Set(selectedIds);
    const rowsToUpdate = filteredRows.filter((row) => selectedIdSet.has(row.id));
    const assignableRows = rowsToUpdate.filter(
      (row) =>
        row.status !== "dismissed" &&
        row.total != null &&
        row.total > 0 &&
        row.currency,
    );
    const skippedCount = rowsToUpdate.length - assignableRows.length;
    if (!assignableRows.length) {
      toast.info(
        t("finance.treasury.invoices.paymentInstrumentNone", {
          defaultValue: "No hay facturas seleccionadas disponibles para asignar a ese medio.",
          currency: instrumentCurrency,
        }),
      );
      return;
    }
    const invoiceCurrencies = Array.from(new Set(assignableRows.map((row) => row.currency?.toUpperCase() ?? ""))).filter(Boolean);
    if (invoiceCurrencies.length > 1) {
      toast.info(
        t("finance.treasury.invoices.paymentInstrumentMixedCurrencies", {
          defaultValue: "Selecciona facturas de una sola moneda para aplicar una tasa manual correctamente.",
        }),
      );
      return;
    }
    const invoiceCurrency = invoiceCurrencies[0] ?? instrumentCurrency;
    if (invoiceCurrency !== instrumentCurrency && !fxRate) {
      setPendingFxRatePrompt({
        title: t("finance.treasury.fxRate.title", { defaultValue: "Definir tasa manual" }),
        body: t("finance.treasury.fxRate.bulkBody", {
          defaultValue: "Estas facturas están en {{from}} y el medio de pago está en {{to}}. Indica la tasa a usar para registrar la asignación.",
          from: invoiceCurrency,
          to: instrumentCurrency,
        }),
        fromCurrency: invoiceCurrency,
        toCurrency: instrumentCurrency,
        onConfirm: async (rate) => {
          await bulkAssignPaymentInstrumentWithRate(paymentInstrumentId, rate);
        },
      });
      return;
    }
    setIsBulkAssigningInstrument(true);
    try {
      let assignedCount = 0;
      let failedCount = 0;
      const batchCommandId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      for (const row of assignableRows) {
        if (row.allocation?.paymentInstrumentId === paymentInstrumentId) {
          assignedCount += 1;
          continue;
        }
        try {
          await mutations.assignInvoiceAllocation({
            commandId: `invoice-allocation-${batchCommandId}-${row.id}-${paymentInstrumentId}`,
            workspaceId,
            actorType: "user",
            sourceChannel: "desktop",
            paymentInstrumentId,
            linkedEntityType: "invoice_extraction",
            linkedEntityId: row.id,
            amountApplied: row.total ?? 0,
            amountCurrency: (row.currency ?? "DOP").toUpperCase(),
            fxRate: invoiceCurrency !== instrumentCurrency ? fxRate : null,
            notes: "Asignado desde bandeja de facturas",
          });
          setOptimisticAllocations((current) => {
            const next = new Map(current);
            next.set(row.id, {
              id: `optimistic-${row.id}-${paymentInstrumentId}`,
              paymentInstrumentId,
              paymentInstrumentLabel: paymentInstrumentLabel.get(paymentInstrumentId) ?? null,
              transactionId: null,
              transactionLabel: null,
              amountApplied: row.total ?? null,
              amountCurrency: row.currency?.toUpperCase() ?? null,
              allocationStatus: "pending",
              cycleStart: row.allocation?.cycleStart ?? null,
              cycleEnd: row.allocation?.cycleEnd ?? null,
              notes: "Asignado desde bandeja de facturas",
            });
            return next;
          });
          assignedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      if (!assignedCount) {
        toast.error(t("finance.treasury.invoices.paymentInstrumentFailed", { defaultValue: "No se pudo asignar el medio de pago." }));
        return;
      }
      toast.success(
        t("finance.treasury.invoices.paymentInstrumentAssigned", {
          defaultValue: "{{count}} factura(s) asignada(s) a medio de pago.",
          count: assignedCount,
        }),
        skippedCount || failedCount
          ? {
              description: t("finance.treasury.invoices.paymentInstrumentSkipped", {
                defaultValue: "{{count}} factura(s) se omitieron por moneda distinta, estado no editable o error de actualización.",
                count: skippedCount + failedCount,
              }),
            }
          : undefined,
      );
      setSelectedIds(new Set());
      inbox.refresh();
      reimbursements.refresh();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          t("finance.treasury.invoices.paymentInstrumentFailed", { defaultValue: "No se pudo asignar el medio de pago." }),
        ),
      );
    } finally {
      setIsBulkAssigningInstrument(false);
    }
  };

  const bulkAssignPaymentInstrument = async (paymentInstrumentId: string) => {
    await bulkAssignPaymentInstrumentWithRate(paymentInstrumentId);
  };

  const markAllocationReimbursed = async (row: InvoiceExtraction) => {
    if (!row.allocation?.id) return;
    setBusyId(row.id);
    try {
      const result = await mutations.markInvoiceAllocationReimbursed({
        commandId: `invoice-allocation-reimbursed-${row.allocation.id}`,
        workspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        allocationId: row.allocation.id,
      });
      toast.success(result.summary);
      inbox.refresh();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          t("finance.treasury.invoices.reimbursedFailed", { defaultValue: "No se pudo marcar reembolsado." }),
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const reconcileWithCandidate = async (row: InvoiceExtraction, candidate: BankTransactionRow, fxRate: number | null = null) => {
    const amountCurrency = (row.currency ?? candidate.currency ?? "DOP").toUpperCase();
    const transactionCurrency = candidate.currency.toUpperCase();
    if (amountCurrency !== transactionCurrency && !fxRate) {
      setPendingFxRatePrompt({
        title: t("finance.treasury.fxRate.title", { defaultValue: "Definir tasa manual" }),
        body: t("finance.treasury.fxRate.reconcileBody", {
          defaultValue:
            "La factura está en {{from}} y el movimiento bancario está en {{to}}. Indica la tasa que se usará para conciliar.",
          from: amountCurrency,
          to: transactionCurrency,
        }),
        fromCurrency: amountCurrency,
        toCurrency: transactionCurrency,
        onConfirm: async (rate) => {
          await reconcileWithCandidate(row, candidate, rate);
        },
      });
      return;
    }
    setBusyId(row.id);
    try {
      let allocationId = row.allocation?.id ?? null;
      if (!allocationId) {
        const assigned = await mutations.assignInvoiceAllocation({
          commandId: `invoice-allocation-${row.id}-${candidate.bankAccountId}`,
          workspaceId,
          actorType: "user",
          sourceChannel: "desktop",
          paymentInstrumentId: candidate.bankAccountId,
          linkedEntityType: "invoice_extraction",
          linkedEntityId: row.id,
          amountApplied: row.total ?? candidate.amount,
          amountCurrency,
          fxRate: amountCurrency !== transactionCurrency ? fxRate : null,
          notes: "Asignado desde conciliación asistida",
        });
        allocationId = assigned.allocationId;
      }
      const result = await mutations.linkInvoiceAllocationToTransaction({
        commandId: `invoice-allocation-link-${allocationId}-${candidate.id}`,
        workspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        allocationId,
        transactionId: candidate.id,
        fxRate: amountCurrency !== transactionCurrency ? fxRate : null,
      });
      toast.success(result.summary);
      setReconciling(null);
      inbox.refresh();
      reimbursements.refresh();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          t("finance.treasury.invoices.reconcile.failed", { defaultValue: "No se pudo conciliar la factura." }),
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const retryRows = async (rows: InvoiceExtraction[]) => {
    const retryableRows = rows.filter((row) => row.status !== "processing" && row.status !== "applied" && row.status !== "dismissed");
    if (!retryableRows.length) {
      toast.info(
        t("finance.treasury.invoices.retryNone", {
          defaultValue: "No hay facturas seleccionadas que se puedan reprocesar.",
        }),
      );
      return;
    }

    const isBulk = retryableRows.length > 1;
    if (isBulk) setIsBulkRetrying(true);
    else setBusyId(retryableRows[0]?.id ?? null);

    try {
      const result = await mutations.retryInvoiceExtractions({
        workspaceId,
        extractionIds: retryableRows.map((row) => row.id),
      });
      toast.success(result.summary);
      setSelectedIds(new Set());
      inbox.refresh();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, t("finance.treasury.invoices.retryFailed", { defaultValue: "No se pudo reprocesar." })),
      );
    } finally {
      if (isBulk) setIsBulkRetrying(false);
      else setBusyId(null);
    }
  };

  return (
    <SurfaceCard className="surface-card--fill invoice-inbox-card">
      <h3 className="section-subtitle">{t("finance.treasury.invoices.title", { defaultValue: "Bandeja de facturas" })}</h3>

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

      {duplicates.data.length > 0 ? (
        <div className="invoice-duplicate-banner">
          <span>
            {t("finance.treasury.invoices.duplicates.banner", {
              defaultValue: "Se detectaron facturas duplicadas ({{count}} grupo(s)).",
              count: duplicates.data.length,
            })}
          </span>
          <button className="action-primary-button" type="button" onClick={() => setShowDuplicates(true)}>
            {t("finance.treasury.invoices.duplicates.review", { defaultValue: "Revisar" })}
          </button>
        </div>
      ) : null}

      {inbox.data.length === 0 ? (
        <GuidedEmptyState
          body={t("finance.treasury.invoices.emptyBody", { defaultValue: "Aún no has subido facturas a esta bandeja." })}
          title={t("finance.treasury.invoices.emptyTitle", { defaultValue: "Sin facturas en cola" })}
        />
      ) : (
        <>
          {showReimbursements
            ? createPortal(
                <div className="document-preview-backdrop invoice-reimbursement-popover-backdrop" onClick={() => setShowReimbursements(false)} role="presentation">
                  <section className="invoice-reimbursement-panel invoice-reimbursement-popover" onClick={(event) => event.stopPropagation()}>
              <div className="invoice-reimbursement-panel-heading">
                <div>
                  <strong>{t("finance.treasury.invoices.reimbursements.title", { defaultValue: "Reembolsos pendientes" })}</strong>
                  <span>
                    {t("finance.treasury.invoices.reimbursements.subtitle", {
                      defaultValue: "Agrupados por responsable, medio de pago y ciclo.",
                    })}
                  </span>
                </div>
                <small>
                  {t("finance.treasury.invoices.reimbursements.groupCount", {
                    defaultValue: "{{count}} grupo(s)",
                    count: reimbursementGroups.length,
                  })}
                </small>
                <div className="invoice-reimbursement-export-actions">
                  <button className="ghost-control" disabled={!reimbursementExportRows.length} onClick={() => void exportReimbursements("csv")} type="button">
                    <Download size={13} />
                    CSV
                  </button>
                  <button className="ghost-control" disabled={!reimbursementExportRows.length} onClick={() => void exportReimbursements("xlsx")} type="button">
                    <Download size={13} />
                    XLSX
                  </button>
                  <button
                    aria-label={t("common.close", { defaultValue: "Cerrar" })}
                    className="icon-ghost-control"
                    onClick={() => setShowReimbursements(false)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="invoice-reimbursement-filters">
                <label className="invoice-reimbursement-filter-field">
                  <span>{t("finance.treasury.invoices.reimbursements.owner", { defaultValue: "Responsable" })}</span>
                  <CompactSelect
                    className="invoice-filter-select"
                    ariaLabel={t("finance.treasury.invoices.reimbursements.filterOwner", { defaultValue: "Filtrar responsable" })}
                    value={reimbursementOwnerFilter}
                    onChange={setReimbursementOwnerFilter}
                    options={reimbursementOwnerOptions}
                  />
                </label>
                <label className="invoice-reimbursement-filter-field">
                  <span>{t("finance.treasury.invoices.reimbursements.instrument", { defaultValue: "Medio de pago" })}</span>
                  <CompactSelect
                    className="invoice-filter-select"
                    ariaLabel={t("finance.treasury.invoices.reimbursements.filterInstrument", { defaultValue: "Filtrar medio" })}
                    value={reimbursementInstrumentFilter}
                    onChange={setReimbursementInstrumentFilter}
                    options={reimbursementInstrumentOptions}
                  />
                </label>
                <label className="invoice-reimbursement-filter-field">
                  <span>{t("finance.treasury.invoices.reimbursements.status", { defaultValue: "Estado" })}</span>
                  <CompactSelect
                    className="invoice-filter-select"
                    ariaLabel={t("finance.treasury.invoices.reimbursements.filterStatus", { defaultValue: "Filtrar estado" })}
                    value={reimbursementStatusFilter}
                    onChange={setReimbursementStatusFilter}
                    options={reimbursementStatusOptions}
                  />
                </label>
                <label className="invoice-reimbursement-date-filter">
                  <span>{t("finance.treasury.invoices.reimbursements.cycleStart", { defaultValue: "Ciclo desde" })}</span>
                  <input
                    className="field-input"
                    type="date"
                    value={reimbursementCycleStartFilter}
                    onChange={(event) => setReimbursementCycleStartFilter(event.target.value)}
                  />
                </label>
                <label className="invoice-reimbursement-date-filter">
                  <span>{t("finance.treasury.invoices.reimbursements.cycleEnd", { defaultValue: "Ciclo hasta" })}</span>
                  <input
                    className="field-input"
                    min={reimbursementCycleStartFilter || undefined}
                    type="date"
                    value={reimbursementCycleEndFilter}
                    onChange={(event) => setReimbursementCycleEndFilter(event.target.value)}
                  />
                </label>
                {hasActiveReimbursementFilters ? (
                  <button
                    className="ghost-control"
                    type="button"
                    onClick={() => {
                      setReimbursementOwnerFilter("all");
                      setReimbursementInstrumentFilter("all");
                      setReimbursementStatusFilter("open");
                      setReimbursementCycleStartFilter("");
                      setReimbursementCycleEndFilter("");
                    }}
                  >
                    {t("finance.treasury.invoices.reimbursements.clearFilters", { defaultValue: "Limpiar filtros" })}
                  </button>
                ) : null}
              </div>
              {reimbursementTotals.length > 0 ? (
                <div className="invoice-reimbursement-totals">
                  {reimbursementTotals.map((total) => (
                    <span key={total.currency}>
                      {formatInvoiceMoney(total.amount, total.currency)} ·{" "}
                      {t("finance.treasury.invoices.reimbursements.invoiceCount", {
                        defaultValue: "{{count}} factura(s)",
                        count: total.invoiceCount,
                      })}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="invoice-reimbursement-grid">
                {reimbursementGroups.length > 0 ? (
                  reimbursementGroups.map((group) => {
                    const isExpanded = expandedReimbursementKeys.has(group.key);
                    return (
                      <article className={`invoice-reimbursement-card${isExpanded ? " is-expanded" : ""}`} key={group.key}>
                        <button
                          className="invoice-reimbursement-card-main"
                          type="button"
                          onClick={() =>
                            setExpandedReimbursementKeys((current) => {
                              const next = new Set(current);
                              if (next.has(group.key)) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })
                          }
                        >
                          <span>{group.owner}</span>
                          <strong>{formatInvoiceMoney(group.amount, group.currency)}</strong>
                          <small>{group.instrument}</small>
                          <em>
                            {group.cycle} · {t("finance.treasury.invoices.reimbursements.invoiceCount", {
                              defaultValue: "{{count}} factura(s)",
                              count: group.count,
                            })}
                          </em>
                        </button>
                        {isExpanded ? (
                          <div className="invoice-reimbursement-detail">
                            {group.items.map((item) => (
                              <div className="invoice-reimbursement-item" key={item.allocationId}>
                                <span>
                                  <strong>{item.originalName}</strong>
                                  <small>{item.supplierName ?? t("finance.treasury.invoices.unknownSupplier", { defaultValue: "Proveedor no detectado" })}</small>
                                </span>
                                <span>
                                  {item.invoiceDate ?? "—"}
                                  {item.ncf ? <small>{item.ncf}</small> : null}
                                </span>
                                <span>
                                  {formatInvoiceMoney(item.amount, item.currency)}
                                  <small>
                                    {item.transactionLabel ??
                                      t("finance.treasury.invoices.reimbursements.noMovement", { defaultValue: "Sin movimiento vinculado" })}
                                  </small>
                                </span>
                                <span className="invoice-reimbursement-actions">
                                  <button
                                    aria-label={t("finance.treasury.invoices.preview", { defaultValue: "Ver factura" })}
                                    className="icon-ghost-control"
                                    disabled={!invoiceRowsById.has(item.invoiceExtractionId)}
                                    onClick={() => {
                                      const row = invoiceRowsById.get(item.invoiceExtractionId);
                                      if (!row) return;
                                      setPreview({ id: row.id, name: row.originalName });
                                    }}
                                    type="button"
                                  >
                                    <FileText size={13} />
                                  </button>
                                  <button
                                    aria-label={t("finance.treasury.invoices.edit", { defaultValue: "Editar" })}
                                    className="icon-ghost-control"
                                    disabled={!invoiceRowsById.has(item.invoiceExtractionId)}
                                    onClick={() => {
                                      const row = invoiceRowsById.get(item.invoiceExtractionId);
                                      if (!row) return;
                                      setEditing(row);
                                    }}
                                    type="button"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    aria-label={t("finance.treasury.invoices.reimbursements.openMovement", { defaultValue: "Ver movimiento" })}
                                    className="icon-ghost-control"
                                    disabled={!item.transactionId || !onOpenMovement}
                                    onClick={() => {
                                      if (item.transactionId) onOpenMovement?.(item.transactionId);
                                    }}
                                    type="button"
                                  >
                                    <ArrowRightLeft size={13} />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="invoice-reimbursement-empty">
                    {t("finance.treasury.invoices.reimbursements.emptyFiltered", {
                      defaultValue: "No hay reembolsos con esos filtros.",
                    })}
                  </div>
                )}
              </div>
                  </section>
                </div>,
                document.body,
              )
            : null}

          {selectedIds.size > 0 ? (
            <div className="invoice-batch-bar">
              <span className="invoice-batch-count" title={t("finance.treasury.invoices.selectionTools", { defaultValue: "Acciones para las facturas seleccionadas" })}>
                {t("finance.treasury.invoices.batchSelected", {
                  defaultValue: "{{count}} seleccionadas",
                  count: selectedIds.size,
                })}
              </span>
              <div className="invoice-batch-controls">
                <div className="invoice-batch-group invoice-batch-group-selection">
                  <button className="ghost-control invoice-batch-action" type="button" onClick={() => setSelectedIds(new Set(filteredRows.map((row) => row.id)))}>
                    {t("finance.treasury.invoices.selectAllVisible", { defaultValue: "Seleccionar todo" })}
                  </button>
                  <button className="ghost-control invoice-batch-action" type="button" onClick={() => setSelectedIds(new Set())}>
                    {t("finance.treasury.invoices.clearSelection", { defaultValue: "Limpiar selección" })}
                  </button>
                </div>
                <div className="invoice-batch-divider" aria-hidden="true" />
                <div className="invoice-batch-group invoice-batch-group-assignment">
                  <CompactSelect
                    className="invoice-filter-select"
                    ariaLabel={t("finance.treasury.invoices.batchAssignUser", { defaultValue: "Asignar gasto de" })}
                    value=""
                    onChange={(value) => void bulkAssignUser(value)}
                    options={[
                      { value: "", label: t("finance.treasury.invoices.batchAssignUser", { defaultValue: "Gasto de…" }) },
                      ...memberOptions,
                    ]}
                  />
                  <CompactSelect
                    className="invoice-filter-select"
                    ariaLabel={t("finance.treasury.invoices.batchAssignProject", { defaultValue: "Asignar proyecto" })}
                    value=""
                    onChange={(value) => {
                      void bulkSetProject(value);
                    }}
                    options={[
                      { value: "", label: t("finance.treasury.invoices.batchAssignProject", { defaultValue: "Proyecto…" }) },
                      {
                        value: GENERAL_PROJECT,
                        label: t("finance.treasury.invoices.generalExpense", { defaultValue: "Gasto general" }),
                        description: t("finance.treasury.invoices.batchGeneralExpenseHint", {
                          defaultValue: "Quita el proyecto de las facturas seleccionadas.",
                        }),
                      },
                      ...projects.map((project) => ({ value: project.id, label: project.name })),
                    ]}
                  />
                  <CompactSelect
                    className="invoice-filter-select invoice-payment-instrument-select"
                    ariaLabel={t("finance.treasury.invoices.batchAssignPaymentInstrument", { defaultValue: "Asignar medio de pago" })}
                    value=""
                    onChange={(value) => void bulkAssignPaymentInstrument(value)}
                    options={bulkPaymentInstrumentOptions}
                    disabled={isBulkAssigningInstrument || bulkPaymentInstrumentOptions.length <= 1}
                  />
                </div>
                <div className="invoice-batch-divider" aria-hidden="true" />
                <div className="invoice-batch-group invoice-batch-group-workflow">
                  <button
                    className="ghost-control invoice-batch-action"
                    disabled={isBulkRetrying || selectedRows.every((row) => !row.suggestedTransactionId || row.status === "applied" || row.status === "dismissed")}
                    onClick={() => void applySelectedSuggested()}
                    type="button"
                  >
                    {isBulkRetrying ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                    {t("finance.treasury.invoices.batchApply", { defaultValue: "Aplicar" })}
                  </button>
                  <button
                    className="ghost-control invoice-batch-action"
                    disabled={selectedRows.length !== 1 || selectedRows[0]?.status === "dismissed" || Boolean(selectedRows[0]?.allocation?.transactionId)}
                    onClick={() => {
                      const [row] = selectedRows;
                      if (row) setReconciling(row);
                    }}
                    type="button"
                  >
                    <ArrowRightLeft size={14} />
                    {t("finance.treasury.invoices.reconcile.open", { defaultValue: "Conciliar" })}
                  </button>
                  <button
                    className="ghost-control invoice-batch-action"
                    disabled={
                      isBulkDismissing ||
                      selectedRows.every((row) => row.status === "dismissed" || !row.allocation?.id || row.allocation.allocationStatus === "reimbursed")
                    }
                    onClick={() => void bulkMarkReimbursedSelected()}
                    type="button"
                  >
                    {isBulkDismissing ? <Loader2 className="spin" size={14} /> : <BadgeCheck size={14} />}
                    {t("finance.treasury.invoices.markReimbursedShort", { defaultValue: "Reembolsado" })}
                  </button>
                </div>
                <div className="invoice-batch-divider" aria-hidden="true" />
                <div className="invoice-batch-group invoice-batch-group-files">
                  <button
                    className="ghost-control invoice-batch-action"
                    disabled={isBulkDownloading}
                    onClick={() => void downloadSelected()}
                    type="button"
                  >
                    {isBulkDownloading ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
                    {t("finance.treasury.invoices.batchDownload", { defaultValue: "Descargar selección" })}
                  </button>
                  <button
                    className="ghost-control invoice-batch-action"
                    disabled={isBulkRetrying || retryableSelectedRows.length === 0}
                    onClick={() => void retryRows(selectedRows)}
                    type="button"
                  >
                    {isBulkRetrying ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                    {t("finance.treasury.invoices.batchRetry", { defaultValue: "Reprocesar selección" })}
                  </button>
                  <button
                    className="ghost-control invoice-batch-action invoice-batch-danger"
                    disabled={isBulkDismissing}
                    onClick={() => void bulkDismissSelected()}
                    type="button"
                  >
                  {isBulkDismissing ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                  {t("finance.treasury.invoices.batchDismiss", { defaultValue: "Borrar selección" })}
                </button>
                </div>
              </div>
            </div>
          ) : null}

          <DataTable
            fillParent
            getRowId={(row) => row.id}
            persistKey="treasury-invoice-inbox-v3"
            syncPreferences
            defaultVisibleColumnKeys={[
              "document",
              "status",
              "supplier",
              "total",
              "currency",
              "invoiceDate",
              "linkedUser",
              "projects",
              "uploadedBy",
              "paymentInstrument",
              "reconciliation",
              "match",
            ]}
            rows={filteredRows}
            selectable
            selectedRowIds={selectedRowIdList}
            onSelectedRowIdsChange={(nextIds) => setSelectedIds(new Set(nextIds))}
            rowActions={(row) => [
              {
                key: "select-all-visible",
                label: t("finance.treasury.invoices.selectAllVisible", { defaultValue: "Seleccionar todo" }),
                disabled: filteredRows.length === 0 || selectedIds.size === filteredRows.length,
                onSelect: () => setSelectedIds(new Set(filteredRows.map((item) => item.id))),
              },
              {
                key: "clear-selection",
                label: t("finance.treasury.invoices.clearSelection", { defaultValue: "Limpiar selección" }),
                disabled: selectedIds.size === 0,
                onSelect: () => setSelectedIds(new Set()),
              },
              {
                key: "download",
                label: t("finance.treasury.invoices.download", { defaultValue: "Descargar" }),
                icon: <Download size={14} />,
                separatorBefore: true,
                disabled: busyId === row.id,
                onSelect: () => void downloadOne(row),
              },
              {
                key: "edit",
                label: t("finance.treasury.invoices.edit", { defaultValue: "Editar" }),
                icon: <Pencil size={14} />,
                onSelect: () => setEditing(row),
              },
              {
                key: "retry",
                label: t("finance.treasury.invoices.retry", { defaultValue: "Reprocesar" }),
                icon: <RotateCcw size={14} />,
                disabled: busyId === row.id || row.status === "processing" || row.status === "applied" || row.status === "dismissed",
                onSelect: () => void retryRows([row]),
              },
              {
                key: "apply",
                label: t("finance.treasury.invoices.apply", { defaultValue: "Aplicar sugerido" }),
                icon: <Check size={14} />,
                disabled: busyId === row.id || row.status === "applied" || row.status === "dismissed" || !row.suggestedTransactionId,
                onSelect: () => void apply(row),
              },
              {
                key: "reconcile",
                label: t("finance.treasury.invoices.reconcile.open", { defaultValue: "Conciliar" }),
                icon: <ArrowRightLeft size={14} />,
                disabled: busyId === row.id || row.status === "dismissed" || Boolean(row.allocation?.transactionId),
                onSelect: () => setReconciling(row),
              },
              {
                key: "reimbursed",
                label: t("finance.treasury.invoices.markReimbursed", { defaultValue: "Marcar reembolsado" }),
                icon: <BadgeCheck size={14} />,
                disabled: busyId === row.id || row.status === "dismissed" || !row.allocation?.id || row.allocation.allocationStatus === "reimbursed",
                onSelect: () => void markAllocationReimbursed(row),
              },
              {
                key: "dismiss",
                label: t("finance.treasury.invoices.dismiss", { defaultValue: "Descartar" }),
                icon: <Trash2 size={14} />,
                tone: "danger",
                separatorBefore: true,
                disabled: busyId === row.id || row.status === "applied" || row.status === "dismissed",
                onSelect: () => void dismiss(row),
              },
            ]}
            controlsAddon={
              <div className="invoice-inbox-toolbar">
                <button className="ghost-control invoice-reimbursement-trigger" onClick={() => setShowReimbursements(true)} type="button">
                  <BadgeCheck size={13} />
                  {t("finance.treasury.invoices.reimbursements.show", { defaultValue: "Reembolsos" })}
                  <span>{reimbursementGroups.length}</span>
                </button>
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
                </div>
              </div>
            }
            columns={[
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
                render: (row) => {
                  const { icon, spin } = statusIcon(row.status);
                  return (
                    <StatusBadge tone={statusTone(row.status)} icon={icon} spin={spin}>
                      {t(`finance.treasury.invoices.status.${row.status}`, { defaultValue: row.status })}
                    </StatusBadge>
                  );
                },
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
                render: (row) => (row.total != null ? formatInvoiceMoney(row.total, row.currency) : "—"),
              },
              {
                key: "currency",
                label: t("finance.treasury.invoices.currency", { defaultValue: "Moneda" }),
                render: (row) => (
                  <CompactSelect
                    className="invoice-currency-select"
                    ariaLabel={t("finance.treasury.invoices.currency", { defaultValue: "Moneda" })}
                    value={(row.currency ?? "DOP").toUpperCase()}
                    onChange={(value) => void setCurrency(row, value)}
                    options={currencyOptions}
                  />
                ),
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
                key: "paymentInstrument",
                label: t("finance.treasury.invoices.columns.paymentInstrument", { defaultValue: "Medio de pago" }),
                render: (row) => {
                  const allocation = optimisticAllocations.get(row.id) ?? row.allocation;
                  if (allocation?.paymentInstrumentId) {
                    return renderPaymentInstrumentLabel(
                      paymentInstrumentLabel.get(allocation.paymentInstrumentId) ?? allocation.paymentInstrumentLabel,
                    );
                  }
                  if (allocation?.paymentInstrumentLabel) {
                    return renderPaymentInstrumentLabel(
                      paymentInstrumentLabelByName.get(allocation.paymentInstrumentLabel) ?? allocation.paymentInstrumentLabel,
                    );
                  }
                  const transactionId = row.appliedTransactionId ?? row.suggestedTransactionId;
                  return transactionId ? renderPaymentInstrumentLabel(txnAccountLabel.get(transactionId)) : "—";
                },
              },
              {
                key: "reconciliation",
                label: t("finance.treasury.invoices.columns.reconciliation", { defaultValue: "Conciliación" }),
                render: (row) => {
                  if (row.allocation?.allocationStatus === "reimbursed") {
                    return (
                      <StatusBadge tone="success">
                        {t("finance.treasury.invoices.reconciliation.reimbursed", { defaultValue: "Reembolsada" })}
                      </StatusBadge>
                    );
                  }
                  if (row.allocation?.allocationStatus === "matched" || row.allocation?.allocationStatus === "partial") {
                    return (
                      <StatusBadge tone="success">
                        {t("finance.treasury.invoices.reconciliation.matched", { defaultValue: "Conciliada" })}
                      </StatusBadge>
                    );
                  }
                  if (row.allocation?.allocationStatus === "pending") {
                    return (
                      <StatusBadge tone="warning">
                        {t("finance.treasury.invoices.reconciliation.assigned", { defaultValue: "Asignada" })}
                      </StatusBadge>
                    );
                  }
                  if (row.allocation?.allocationStatus === "rejected") {
                    return (
                      <StatusBadge tone="critical">
                        {t("finance.treasury.invoices.reconciliation.rejected", { defaultValue: "Rechazada" })}
                      </StatusBadge>
                    );
                  }
                  if (row.status === "applied" && row.appliedTransactionId) {
                    return (
                      <StatusBadge tone="success">
                        {t("finance.treasury.invoices.reconciliation.applied", { defaultValue: "Aplicada" })}
                      </StatusBadge>
                    );
                  }
                  if (row.suggestedTransactionId) {
                    return (
                      <StatusBadge tone="info">
                        {t("finance.treasury.invoices.reconciliation.suggested", { defaultValue: "Sugerida" })}
                      </StatusBadge>
                    );
                  }
                  if (row.status === "failed") {
                    return (
                      <StatusBadge tone="critical">
                        {t("finance.treasury.invoices.reconciliation.failed", { defaultValue: "Error" })}
                      </StatusBadge>
                    );
                  }
                  return (
                    <StatusBadge tone="neutral">
                      {t("finance.treasury.invoices.reconciliation.pending", { defaultValue: "Pendiente" })}
                    </StatusBadge>
                  );
                },
              },
              {
                key: "match",
                label: t("finance.treasury.invoices.columns.match", { defaultValue: "Movimiento sugerido" }),
                render: (row) =>
                  row.allocation?.transactionLabel
                    ? row.allocation.transactionLabel
                    : row.status === "applied" && row.appliedTransactionId
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
                render: (row) => {
                  const downloadLabel = t("finance.treasury.invoices.download", { defaultValue: "Descargar" });
                  const editLabel = t("finance.treasury.invoices.edit", { defaultValue: "Editar" });
                  const retryLabel = t("finance.treasury.invoices.retry", { defaultValue: "Reprocesar" });
                  const applyLabel = t("finance.treasury.invoices.apply", { defaultValue: "Aplicar" });
                  const reconcileLabel = t("finance.treasury.invoices.reconcile.open", { defaultValue: "Conciliar" });
                  const reimbursedLabel = t("finance.treasury.invoices.markReimbursed", { defaultValue: "Marcar reembolsado" });
                  const dismissLabel = t("finance.treasury.invoices.dismiss", { defaultValue: "Descartar" });
                  return (
                    <span className="invoice-actions-cell">
                      <button
                        type="button"
                        className="icon-ghost-control"
                        disabled={busyId === row.id}
                        onClick={() => void downloadOne(row)}
                        data-tooltip={downloadLabel}
                        aria-label={downloadLabel}
                      >
                        <Download size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control"
                        onClick={() => setEditing(row)}
                        data-tooltip={editLabel}
                        aria-label={editLabel}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control"
                        disabled={
                          busyId === row.id ||
                          row.status === "processing" ||
                          row.status === "applied" ||
                          row.status === "dismissed"
                        }
                        onClick={() => void retryRows([row])}
                        data-tooltip={retryLabel}
                        aria-label={retryLabel}
                      >
                        {busyId === row.id ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control is-success"
                        disabled={
                          busyId === row.id ||
                          row.status === "applied" ||
                          row.status === "dismissed" ||
                          !row.suggestedTransactionId
                        }
                        onClick={() => void apply(row)}
                        data-tooltip={applyLabel}
                        aria-label={applyLabel}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control"
                        disabled={
                          busyId === row.id ||
                          row.status === "dismissed" ||
                          Boolean(row.allocation?.transactionId)
                        }
                        onClick={() => setReconciling(row)}
                        data-tooltip={reconcileLabel}
                        aria-label={reconcileLabel}
                      >
                        <ArrowRightLeft size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control is-success"
                        disabled={
                          busyId === row.id ||
                          row.status === "dismissed" ||
                          !row.allocation?.id ||
                          row.allocation.allocationStatus === "reimbursed"
                        }
                        onClick={() => void markAllocationReimbursed(row)}
                        data-tooltip={reimbursedLabel}
                        aria-label={reimbursedLabel}
                      >
                        <BadgeCheck size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-control is-danger"
                        disabled={busyId === row.id || row.status === "applied" || row.status === "dismissed"}
                        onClick={() => void dismiss(row)}
                        data-tooltip={dismissLabel}
                        aria-label={dismissLabel}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  );
                },
              },
            ]}
          />
        </>
      )}

      {confirmDialog}

      {showDuplicates ? (
        <InvoiceDuplicatesDialog
          groups={duplicates.data}
          formatMoney={formatMoney}
          onClose={() => setShowDuplicates(false)}
          onResolve={resolveDuplicates}
        />
      ) : null}

      <DocumentPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ""}
        dataUrl={previewData?.dataUrl ?? null}
        mimeType={previewData?.mimeType ?? null}
        isLoading={previewLoading}
        loadingLabel={t("finance.treasury.invoices.previewLoading", { defaultValue: "Cargando documento…" })}
      />

      {pendingFxRatePrompt ? (
        <FxRateDialog
          prompt={pendingFxRatePrompt}
          onClose={() => setPendingFxRatePrompt(null)}
        />
      ) : null}

      {editing ? (
        <InvoiceEditModal
          extraction={editing}
          categories={expenseCategories}
          paymentInstrumentOptions={editingPaymentInstrumentOptions}
          onClose={() => setEditing(null)}
          onPaymentInstrumentChange={async (paymentInstrumentId) => {
            if (!paymentInstrumentId || !editing.total || !editing.currency) return;
            const instrument = accountById.get(paymentInstrumentId);
            if (!instrument) {
              toast.error(t("finance.treasury.invoices.paymentInstrumentMissing", { defaultValue: "Ese medio de pago ya no está disponible." }));
              return;
            }
            const invoiceCurrency = editing.currency.toUpperCase();
            const instrumentCurrency = instrument.currency.toUpperCase();
            const assignWithRate = async (fxRate: number | null = null) => {
              const commandId =
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
              const result = await mutations.assignInvoiceAllocation({
                commandId: `invoice-allocation-${commandId}-${editing.id}-${paymentInstrumentId}`,
                workspaceId,
                actorType: "user",
                sourceChannel: "desktop",
                paymentInstrumentId,
                linkedEntityType: "invoice_extraction",
                linkedEntityId: editing.id,
                amountApplied: editing.total ?? 0,
                amountCurrency: invoiceCurrency,
                fxRate,
                notes: "Asignado desde edición de factura",
              });
              const nextAllocation: InvoiceExtractionAllocation = {
                id: result.allocationId,
                paymentInstrumentId,
                paymentInstrumentLabel: paymentInstrumentLabel.get(paymentInstrumentId) ?? null,
                transactionId: null,
                transactionLabel: null,
                amountApplied: editing.total ?? null,
                amountCurrency: invoiceCurrency,
                allocationStatus: "pending",
                cycleStart: editing.allocation?.cycleStart ?? null,
                cycleEnd: editing.allocation?.cycleEnd ?? null,
                notes: "Asignado desde edición de factura",
              };
              setOptimisticAllocations((current) => {
                const next = new Map(current);
                next.set(editing.id, nextAllocation);
                return next;
              });
              setEditing((current) =>
                current?.id === editing.id
                  ? {
                      ...current,
                      allocation: nextAllocation,
                    }
                  : current,
              );
              inbox.refresh();
              reimbursements.refresh();
            };
            if (instrumentCurrency !== invoiceCurrency) {
              setPendingFxRatePrompt({
                title: t("finance.treasury.fxRate.title", { defaultValue: "Definir tasa manual" }),
                body: t("finance.treasury.fxRate.singleBody", {
                  defaultValue:
                    "Esta factura está en {{from}} y el medio de pago está en {{to}}. Indica la tasa que se usará para esta asignación.",
                  from: invoiceCurrency,
                  to: instrumentCurrency,
                }),
                fromCurrency: invoiceCurrency,
                toCurrency: instrumentCurrency,
                onConfirm: async (rate) => {
                  await assignWithRate(rate);
                },
              });
              return;
            }
            await assignWithRate(null);
          }}
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

      {reconciling ? (
        <ReconciliationDrawer
          candidates={reconciliationCandidates}
          extraction={reconciling}
          formatMoney={formatMoney}
          isBusy={busyId === reconciling.id}
          onClose={() => setReconciling(null)}
          onSelect={(candidate) => void reconcileWithCandidate(reconciling, candidate)}
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

const FxRateDialog = ({ prompt, onClose }: { prompt: PendingFxRatePrompt; onClose: () => void }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(prompt.defaultRate ? String(prompt.defaultRate) : "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());

  const confirm = async () => {
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("finance.treasury.fxRate.invalid", { defaultValue: "Introduce una tasa mayor que cero." }));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await prompt.onConfirm(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.treasury.fxRate.failed", { defaultValue: "No se pudo aplicar la tasa." }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalShell
      backdropClassName="compare-dialog-backdrop"
      className="invoice-fx-rate-dialog"
      onClose={isSaving ? () => undefined : onClose}
      width={520}
    >
      <div className="document-preview-header">
        <span className="document-preview-title">{prompt.title}</span>
        <button className="icon-ghost-control" onClick={onClose} type="button" aria-label="Close" disabled={isSaving}>
          <X size={16} />
        </button>
      </div>
      <div className="invoice-fx-rate-body">
        <p>{prompt.body}</p>
        <label>
          <span>
            {t("finance.treasury.fxRate.field", {
              defaultValue: "Tasa {{from}} → {{to}}",
              from: prompt.fromCurrency,
              to: prompt.toCurrency,
            })}
          </span>
          <input
            autoFocus
            className="field-input"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/[^\d.,]/g, ""))}
          />
        </label>
        <small>
          {t("finance.treasury.fxRate.help", {
            defaultValue: "La tasa queda guardada en esta asignación/conciliación para que el documento no cambie si luego cambia la tasa global.",
          })}
        </small>
        {error ? <span className="form-error">{error}</span> : null}
      </div>
      <div className="document-preview-header" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--hairline-faint, rgba(255,255,255,0.05))", borderBottom: 0 }}>
        <button className="ghost-control" type="button" onClick={onClose} disabled={isSaving}>
          {t("common.cancel", { defaultValue: "Cancelar" })}
        </button>
        <button className="action-primary-button" type="button" onClick={() => void confirm()} disabled={isSaving}>
          <Check size={15} />
          <span>{t("common.apply", { defaultValue: "Aplicar" })}</span>
        </button>
      </div>
    </ModalShell>
  );
};

const InvoiceEditModal = ({
  extraction,
  categories,
  paymentInstrumentOptions,
  onClose,
  onPaymentInstrumentChange,
  onSave,
}: {
  extraction: InvoiceExtraction;
  categories: string[];
  paymentInstrumentOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onPaymentInstrumentChange: (paymentInstrumentId: string) => Promise<void>;
  onSave: (patch: EditPatch) => void;
}) => {
  const { t } = useTranslation();
  const formatMoneyDraft = (value: number | null | undefined) =>
    value == null
      ? ""
      : value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const [form, setForm] = useState({
    supplierName: extraction.supplierName ?? "",
    supplierRnc: extraction.supplierRnc ?? "",
    ncf: extraction.ncf ?? "",
    invoiceDate: extraction.invoiceDate ?? "",
    subtotal: formatMoneyDraft(extraction.subtotal),
    itbis: formatMoneyDraft(extraction.itbis),
    total: formatMoneyDraft(extraction.total),
    currency: extraction.currency ?? "DOP",
    expenseCategory: extraction.expenseCategory ?? "",
  });

  const num = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const updateMoneyField = (key: "subtotal" | "itbis" | "total", value: string) => {
    const cleaned = value.replace(/[^\d.,-]/g, "");
    setForm((prev) => ({ ...prev, [key]: cleaned }));
  };
  const formatMoneyField = (key: "subtotal" | "itbis" | "total") => {
    setForm((prev) => {
      const parsed = num(prev[key]);
      return { ...prev, [key]: parsed == null ? "" : formatMoneyDraft(parsed) };
    });
  };

  const moneyLabel = (label: string) => `${label} (${form.currency || "DOP"})`;
  const fields: Array<{ key: keyof typeof form; label: string; numeric?: boolean }> = [
    { key: "supplierName", label: t("finance.treasury.invoices.columns.supplier", { defaultValue: "Proveedor" }) },
    { key: "supplierRnc", label: t("finance.treasury.invoices.rnc", { defaultValue: "RNC" }) },
    { key: "ncf", label: t("finance.treasury.invoices.columns.ncf", { defaultValue: "NCF" }) },
    { key: "invoiceDate", label: t("finance.treasury.invoices.columns.date", { defaultValue: "Fecha" }) },
    { key: "subtotal", label: moneyLabel(t("finance.treasury.invoices.subtotal", { defaultValue: "Subtotal" })), numeric: true },
    { key: "itbis", label: moneyLabel(t("finance.treasury.invoices.columns.itbis", { defaultValue: "ITBIS" })), numeric: true },
    { key: "total", label: moneyLabel(t("finance.treasury.invoices.columns.total", { defaultValue: "Total" })), numeric: true },
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
            <label>
              <span>{t("finance.treasury.invoices.columns.paymentInstrument", { defaultValue: "Medio de pago" })}</span>
              <CompactSelect
                ariaLabel={t("finance.treasury.invoices.columns.paymentInstrument", { defaultValue: "Medio de pago" })}
                value={extraction.allocation?.paymentInstrumentId ?? ""}
                onChange={(next) => void onPaymentInstrumentChange(next)}
                options={paymentInstrumentOptions}
              />
            </label>
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
                ) : field.key === "currency" ? (
                  <CompactSelect
                    ariaLabel={field.label}
                    value={form.currency || "DOP"}
                    onChange={(next) => setForm((prev) => ({ ...prev, currency: next }))}
                    options={currencyOptions}
                  />
                ) : field.key === "invoiceDate" ? (
                  <input
                    className="field-input"
                    type="date"
                    value={form.invoiceDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, invoiceDate: event.target.value }))}
                  />
                ) : field.numeric ? (
                  <div className="invoice-money-input-shell">
                    <span className="invoice-money-prefix">{form.currency || "DOP"}</span>
                    <input
                      className="field-input invoice-money-input"
                      inputMode="decimal"
                      value={form[field.key]}
                      onBlur={() => formatMoneyField(field.key as "subtotal" | "itbis" | "total")}
                      onChange={(event) => updateMoneyField(field.key as "subtotal" | "itbis" | "total", event.target.value)}
                    />
                  </div>
                ) : (
                  <input
                    className="field-input"
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

const ReconciliationDrawer = ({
  candidates,
  extraction,
  formatMoney,
  isBusy,
  onClose,
  onSelect,
}: {
  candidates: ReconciliationCandidate[];
  extraction: InvoiceExtraction;
  formatMoney: (value: number) => string;
  isBusy: boolean;
  onClose: () => void;
  onSelect: (candidate: BankTransactionRow) => void;
}) => {
  const { t } = useTranslation();
  return createPortal(
    <div className="document-preview-backdrop" onClick={onClose} role="presentation">
      <aside
        aria-label={t("finance.treasury.invoices.reconcile.title", { defaultValue: "Conciliar factura" })}
        className="invoice-reconcile-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="invoice-reconcile-header">
          <div>
            <span>{t("finance.treasury.invoices.reconcile.eyebrow", { defaultValue: "Conciliación asistida" })}</span>
            <h3>{extraction.supplierName ?? extraction.originalName}</h3>
            <p>
              {extraction.total != null
                ? formatInvoiceMoney(extraction.total, extraction.currency)
                : t("finance.treasury.invoices.reconcile.noTotal", { defaultValue: "Sin total extraído" })}
              {extraction.invoiceDate ? ` · ${extraction.invoiceDate}` : ""}
            </p>
          </div>
          <button className="icon-ghost-control" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>

        <div className="invoice-reconcile-list">
          {candidates.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.invoices.reconcile.emptyBody", {
                defaultValue: "No encontramos movimientos suficientemente parecidos. Puedes ajustar total/fecha o importar más movimientos.",
              })}
              title={t("finance.treasury.invoices.reconcile.emptyTitle", { defaultValue: "Sin candidatos claros" })}
            />
          ) : (
            candidates.map((candidate) => (
              <button
                className="invoice-reconcile-candidate"
                disabled={isBusy}
                key={candidate.row.id}
                onClick={() => onSelect(candidate.row)}
                type="button"
              >
                <span className="invoice-reconcile-score">{candidate.score}%</span>
                <span className="invoice-reconcile-main">
                  <strong>{candidate.row.rawDescription ?? candidate.row.reference ?? candidate.row.id}</strong>
                  <small>
                    {candidate.row.txnDate} · {candidate.row.bankAccountLabel} · {formatMoney(candidate.row.amount)}
                  </small>
                </span>
                <span className="invoice-reconcile-reasons">
                  {candidate.reasons.slice(0, 3).map((reason) => (
                    <em key={reason}>{reason}</em>
                  ))}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------------- */
/* Duplicate resolution dialog                                               */
/* ------------------------------------------------------------------------- */

const InvoiceDuplicatesDialog = ({
  groups,
  formatMoney,
  onClose,
  onResolve,
}: {
  groups: InvoiceDuplicateGroup[];
  formatMoney: (value: number) => string;
  onClose: () => void;
  onResolve: (idsToDismiss: string[]) => void;
}) => {
  const { t } = useTranslation();
  // Default keeper per group = the oldest (first) item.
  const [keepers, setKeepers] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.contentHash, g.items[0]?.id ?? ""])),
  );

  const idsToDismiss = groups.flatMap((g) =>
    g.items.filter((item) => item.id !== keepers[g.contentHash]).map((item) => item.id),
  );

  return createPortal(
    <div className="document-preview-backdrop" onClick={onClose} role="presentation">
      <div
        className="document-preview-dialog"
        style={{ width: "min(680px, 94vw)" }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="document-preview-header">
          <span className="document-preview-title">
            {t("finance.treasury.invoices.duplicates.title", { defaultValue: "Resolver facturas duplicadas" })}
          </span>
          <button className="icon-ghost-control" onClick={onClose} type="button" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="document-preview-body" style={{ display: "block" }}>
          <p className="surface-card-subtitle" style={{ marginBottom: 10 }}>
            {t("finance.treasury.invoices.duplicates.help", {
              defaultValue: "Elige cuál conservar en cada grupo; las demás se descartarán.",
            })}
          </p>
          {groups.map((group) => (
            <div className="invoice-duplicate-group" key={group.contentHash}>
              {group.items.map((item) => (
                <label className="invoice-duplicate-row" key={item.id}>
                  <input
                    type="radio"
                    name={`keep-${group.contentHash}`}
                    checked={keepers[group.contentHash] === item.id}
                    onChange={() => setKeepers((prev) => ({ ...prev, [group.contentHash]: item.id }))}
                  />
                  <span className="invoice-duplicate-name">{item.originalName}</span>
                  <span className="text-muted">
                    {item.total != null ? formatMoney(item.total) : "—"} ·{" "}
                    {item.uploadedByName ?? "—"} · {item.createdAt.slice(0, 10)}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div
          className="document-preview-header"
          style={{ justifyContent: "flex-end", borderTop: "1px solid var(--hairline-faint, rgba(255,255,255,0.05))", borderBottom: 0 }}
        >
          <button className="ghost-control" type="button" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Cancelar" })}
          </button>
          <button
            className="action-danger-button"
            type="button"
            disabled={idsToDismiss.length === 0}
            onClick={() => onResolve(idsToDismiss)}
          >
            {t("finance.treasury.invoices.duplicates.apply", {
              defaultValue: "Descartar {{count}} duplicado(s)",
              count: idsToDismiss.length,
            })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
