import { Eye, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { InvoiceRow, InvoiceStatus, ListSortDirection } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { AgentCreatedBadge } from "@shared/components/AgentCreatedBadge";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";

import { formatCurrency } from "./quoteHelpers";
import { useInvoicesList } from "./useInvoiceData";

type InvoiceSortField = "issueDate" | "number" | "client" | "dueDate" | "total" | "status";

const allStatuses: Array<InvoiceStatus | "all"> = ["all", "draft", "issued", "partially_paid", "paid", "cancelled", "void"];

const sortOptions: Array<{ value: InvoiceSortField; label: string; columnKey?: string }> = [
  { value: "issueDate", label: "finance.invoices.sort.issueDate", columnKey: "issueDate" },
  { value: "number", label: "finance.invoices.sort.number", columnKey: "number" },
  { value: "client", label: "finance.invoices.sort.client", columnKey: "client" },
  { value: "dueDate", label: "finance.invoices.sort.dueDate", columnKey: "dueDate" },
  { value: "total", label: "finance.invoices.sort.total", columnKey: "total" },
  { value: "status", label: "finance.invoices.sort.status", columnKey: "status" },
];

const statusTone = (status: InvoiceStatus) => {
  if (status === "paid") return "success" as const;
  if (status === "issued" || status === "partially_paid") return "warning" as const;
  // `void` is a fiscal annulment → keep it critical; a plain `cancelled`
  // invoice is a terminal-inactive state → neutral (see polish audit decision).
  if (status === "void") return "critical" as const;
  return "neutral" as const;
};

export const InvoicesPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<InvoiceSortField>("issueDate");
  const [sortDirection, setSortDirection] = useState<ListSortDirection>("desc");

  const filter = useMemo(
    () => ({
      workspaceId: activeWorkspaceId,
      status: statusFilter === "all" ? undefined : statusFilter,
      search: search.trim() || undefined,
    }),
    [activeWorkspaceId, statusFilter, search],
  );
  const { data, isLoading, error } = useInvoicesList(filter);

  const statusLabel = (status: InvoiceStatus | "all") =>
    status === "all" ? t("finance.invoices.filters.all") : t(`finance.invoices.status.${status}`, { defaultValue: status });

  const summary = useMemo(() => {
    const baseCurrency = data[0]?.baseCurrency ?? "DOP";
    const total = data.reduce((sum, row) => sum + row.baseCurrencyTotalAmount, 0);
    const outstanding = data.reduce((sum, row) => sum + row.outstandingAmount * row.exchangeRate, 0);
    const issued = data.filter((row) => row.status === "issued" || row.status === "partially_paid").length;
    return { baseCurrency, total, outstanding, issued };
  }, [data]);

  const visibleInvoices = useMemo(() => {
    const compare = (left: InvoiceRow, right: InvoiceRow) => {
      switch (sortBy) {
        case "number":
          return left.invoiceYear - right.invoiceYear || left.invoiceSequence - right.invoiceSequence;
        case "client":
          return left.clientNameSnapshot.localeCompare(right.clientNameSnapshot);
        case "dueDate":
          return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
        case "total":
          return left.baseCurrencyTotalAmount - right.baseCurrencyTotalAmount;
        case "status":
          return left.status.localeCompare(right.status);
        default:
          return left.issueDate.localeCompare(right.issueDate);
      }
    };
    const sorted = [...data].sort(compare);
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [data, sortBy, sortDirection]);

  const activeSortOption = sortOptions.find((option) => option.value === sortBy);
  const activeColumnKey = activeSortOption?.columnKey ?? null;
  const hasActiveFilters = statusFilter !== "all" || Boolean(search.trim());

  const handleColumnSortRequest = (columnKey: string) => {
    const option = sortOptions.find((candidate) => candidate.columnKey === columnKey);
    if (!option) return;
    if (option.value === sortBy) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(option.value);
      setSortDirection(option.value === "issueDate" || option.value === "total" ? "desc" : "asc");
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "number",
        label: t("finance.invoices.columns.invoiceNumber"),
        render: (row: InvoiceRow) => (
          <span className="quotes-list-number-cell">
            <span className="quotes-list-number">{row.invoiceNumber}</span>
            {row.createdByActorType === "agent" ? <AgentCreatedBadge variant="table" /> : null}
          </span>
        ),
      },
      {
        key: "ncf",
        label: t("finance.invoices.columns.ncf"),
        render: (row: InvoiceRow) =>
          row.ncf ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.ncf}</span> : <span className="text-muted">—</span>,
      },
      {
        key: "client",
        label: t("finance.invoices.columns.client"),
        render: (row: InvoiceRow) => (
          <div className="cell-stack">
            <span>{row.clientNameSnapshot}</span>
            {row.productionCompanyNameSnapshot ? (
              <small className="text-muted">{row.productionCompanyNameSnapshot}</small>
            ) : null}
          </div>
        ),
      },
      {
        key: "project",
        label: t("finance.invoices.columns.projectProduction"),
        render: (row: InvoiceRow) => row.projectNameSnapshot || row.productionName || "—",
      },
      {
        key: "issueDate",
        label: t("finance.invoices.columns.issueDate"),
        render: (row: InvoiceRow) => row.issueDate,
      },
      {
        key: "dueDate",
        label: t("finance.invoices.columns.dueDate"),
        render: (row: InvoiceRow) => row.dueDate ?? "—",
      },
      {
        key: "total",
        label: t("finance.invoices.columns.total"),
        align: "right" as const,
        render: (row: InvoiceRow) => (
          <div className="cell-stack" style={{ alignItems: "flex-end" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(row.totalAmount, row.currency, language)}</strong>
            {row.outstandingAmount > 0 ? (
              <small className="text-muted">
                {t("finance.invoices.outstanding", { amount: formatCurrency(row.outstandingAmount, row.currency, language) })}
              </small>
            ) : null}
          </div>
        ),
      },
      {
        key: "status",
        label: t("finance.invoices.columns.status"),
        render: (row: InvoiceRow) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>,
      },
    ],
    [language, t],
  );

  return (
    <div className="page-stack page-stack--fill">
      <div className="page-stack-row">
        <SectionHeader eyebrow={t("finance.title")} title={t("finance.invoices.title")} titleTone="accent" />
        <button className="action-primary-button" onClick={() => navigate("/finance/invoices/new")} type="button">
          <Plus size={13} />
          <span>{t("finance.invoices.actions.newManual")}</span>
        </button>
      </div>

      <SurfaceCard className="quotes-summary-card">
        <div className="quotes-summary-grid">
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.totalInvoices")}</span>
            <strong className="quotes-summary-tile-value">{data.length}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.issuedOpen")}</span>
            <strong className="quotes-summary-tile-value">{summary.issued}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.totalAmount")}</span>
            <strong className="quotes-summary-tile-value">{formatCurrency(summary.total, summary.baseCurrency, language)}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.outstanding")}</span>
            <strong className="quotes-summary-tile-value">{formatCurrency(summary.outstanding, summary.baseCurrency, language)}</strong>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="surface-card--fill">
        <ListToolbar
          activeSortLabel={activeSortOption ? t(activeSortOption.label) : undefined}
          onSearchValueChange={setSearch}
          onSortByChange={(value) => {
            setSortBy(value);
            setSortDirection(value === "issueDate" || value === "total" ? "desc" : "asc");
          }}
          onToggleSortDirection={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
          resultCount={visibleInvoices.length}
          resultLabel={t("finance.invoices.toolbar.resultLabel")}
          searchPlaceholder={t("finance.invoices.searchPlaceholder")}
          searchValue={search}
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortOptions={sortOptions.map((option) => ({ ...option, label: t(option.label) }))}
          rightActions={
            <label className="compact-filter-field">
              <span>{t("finance.invoices.filters.status")}</span>
              <select
                className="compact-filter-select"
                onChange={(event) => setStatusFilter(event.target.value as InvoiceStatus | "all")}
                value={statusFilter}
              >
                {allStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          }
        />

        {isLoading && data.length === 0 ? <TableSkeleton rows={6} /> : null}

        <DataTable<InvoiceRow>
          columns={columns}
          emptyContent={
            <div className="table-empty-state">
              <span className="table-empty-kicker">
                {hasActiveFilters ? t("finance.invoices.empty.filteredKicker") : t("finance.invoices.empty.kicker")}
              </span>
              <strong>{hasActiveFilters ? t("finance.invoices.empty.noMatchesTitle") : t("finance.invoices.empty.noInvoicesTitle")}</strong>
              <span>{hasActiveFilters ? t("finance.invoices.empty.noMatchesBody") : t("finance.invoices.empty.noInvoicesBody")}</span>
            </div>
          }
          fillParent
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/finance/invoices/${row.id}`)}
          onSortRequest={handleColumnSortRequest}
          rowActions={(row) => [
            {
              key: "open",
              label: t("finance.invoices.actions.view"),
              icon: <Eye size={14} />,
              onSelect: (target) => navigate(`/finance/invoices/${target.id}`),
            },
            {
              key: "edit",
              label: t("finance.invoices.actions.edit"),
              icon: <Pencil size={14} />,
              disabled: row.status !== "draft",
              onSelect: (target) => navigate(`/finance/invoices/${target.id}/edit`),
            },
          ]}
          persistKey="invoices-list-v1"
          rows={visibleInvoices}
          sortState={activeColumnKey ? { columnKey: activeColumnKey, direction: sortDirection } : null}
        />

        {error ? <div className="form-inline-error">{error}</div> : null}
      </SurfaceCard>
    </div>
  );
};

export default InvoicesPage;
