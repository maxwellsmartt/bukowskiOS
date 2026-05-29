import { Eye, FileText, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { InvoiceRow, InvoiceStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { AgentCreatedBadge } from "@shared/components/AgentCreatedBadge";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";

import { formatCurrency } from "./quoteHelpers";
import { useInvoicesList } from "./useInvoiceData";

const allStatuses: Array<InvoiceStatus | "all"> = [
  "all",
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
  "void",
];

const statusTone = (status: InvoiceStatus) => {
  if (status === "paid") return "success" as const;
  if (status === "issued" || status === "partially_paid") return "warning" as const;
  if (status === "cancelled" || status === "void") return "critical" as const;
  return "neutral" as const;
};

export const InvoicesPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");

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
    status === "all"
      ? t("finance.invoices.filters.all")
      : t(`finance.invoices.status.${status}`, { defaultValue: status });

  const summary = useMemo(() => {
    const baseCurrency = data[0]?.baseCurrency ?? "DOP";
    const total = data.reduce((sum, row) => sum + row.baseCurrencyTotalAmount, 0);
    const outstanding = data.reduce((sum, row) => sum + row.outstandingAmount * row.exchangeRate, 0);
    const issued = data.filter((row) => row.status === "issued" || row.status === "partially_paid").length;
    return { baseCurrency, total, outstanding, issued };
  }, [data]);

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
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(row.totalAmount, row.currency, language)}
            </strong>
            {row.outstandingAmount > 0 ? (
              <small className="text-muted">
                {t("finance.invoices.outstanding", {
                  amount: formatCurrency(row.outstandingAmount, row.currency, language),
                })}
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
      {
        key: "actions",
        label: t("finance.invoices.columns.actions"),
        align: "right" as const,
        width: 92,
        render: (row: InvoiceRow) => (
          <button
            className="icon-ghost-control"
            data-table-row-action
            onClick={() => navigate(`/finance/invoices/${row.id}`)}
            title={t("finance.invoices.actions.view")}
            type="button"
          >
            <Eye size={14} />
          </button>
        ),
      },
    ],
    [language, navigate, t],
  );

  return (
    <div className="page-stack page-stack--fill">
      <div className="page-stack-row">
        <SectionHeader eyebrow={t("finance.title")} title={t("finance.invoices.title")} titleTone="accent" />
        <button
          className="ghost-control is-active"
          onClick={() => navigate("/finance/invoices/new")}
          type="button"
        >
          <Plus size={13} />
          <span>{t("finance.invoices.actions.newManual")}</span>
        </button>
      </div>

      <SurfaceCard className="quotes-summary-card">
        <div className="quotes-summary-grid">
          <button
            className={`quotes-summary-tile${statusFilter === "all" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("all")}
            type="button"
          >
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.totalInvoices")}</span>
            <strong className="quotes-summary-tile-value">{data.length}</strong>
          </button>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.issuedOpen")}</span>
            <strong className="quotes-summary-tile-value">{summary.issued}</strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.totalAmount")}</span>
            <strong className="quotes-summary-tile-value">
              {formatCurrency(summary.total, summary.baseCurrency, language)}
            </strong>
          </div>
          <div className="quotes-summary-tile">
            <span className="quotes-summary-tile-label">{t("finance.invoices.summary.outstanding")}</span>
            <strong className="quotes-summary-tile-value">
              {formatCurrency(summary.outstanding, summary.baseCurrency, language)}
            </strong>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="surface-card--fill">
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="compact-filter-field quotes-status-filter">
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
          <input
            className="field-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("finance.invoices.searchPlaceholder")}
            style={{ minWidth: 260, marginLeft: "auto" }}
            value={search}
          />
        </div>

        {isLoading && data.length === 0 ? (
          <TableSkeleton rows={6} />
        ) : data.length === 0 ? (
          <GuidedEmptyState
            actionLabel={search || statusFilter !== "all" ? t("finance.invoices.empty.clearFilters") : undefined}
            body={
              search || statusFilter !== "all"
                ? t("finance.invoices.empty.noMatchesBody")
                : t("finance.invoices.empty.noInvoicesBody")
            }
            onAction={
              search || statusFilter !== "all"
                ? () => {
                    setSearch("");
                    setStatusFilter("all");
                  }
                : undefined
            }
            title={
              search || statusFilter !== "all"
                ? t("finance.invoices.empty.noMatchesTitle")
                : t("finance.invoices.empty.noInvoicesTitle")
            }
          />
        ) : (
          <DataTable<InvoiceRow>
            columns={columns}
            fillParent
            getRowId={(row) => row.id}
            onRowDoubleClick={(row) => navigate(`/finance/invoices/${row.id}`)}
            rowActions={(row) => [
              {
                key: "open",
                label: t("finance.invoices.actions.view"),
                icon: <Eye size={14} />,
                onSelect: (target) => navigate(`/finance/invoices/${target.id}`),
              },
            ]}
            persistKey="invoices-list-v1"
            rows={data}
          />
        )}

        {error ? <div className="form-inline-error">{error}</div> : null}
      </SurfaceCard>

      <SurfaceCard className="invoice-footnote-card">
        <div className="invoice-footnote-content">
          <FileText size={15} />
          <span>{t("finance.invoices.footnote")}</span>
        </div>
      </SurfaceCard>
    </div>
  );
};

export default InvoicesPage;
