import { Copy, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import type { QuoteRow, QuoteStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { AgentCreatedBadge } from "@shared/components/AgentCreatedBadge";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";

import {
  formatCurrency,
  newCommandId,
  statusLabel,
  statusTone,
} from "./quoteHelpers";
import { QuoteVersionsStrip } from "./QuoteVersionsStrip";
import { useQuoteMutations, useQuotesList } from "./useQuoteData";

const allStatuses: Array<QuoteStatus | "all"> = [
  "all",
  "draft",
  "sent",
  "approved",
  "rejected",
  "expired",
  "cancelled",
];

const cleanIpcMessage = (err: unknown, fallback: string) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
    : fallback;

export const QuotesPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const { language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<QuoteRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Single-click on a row reveals an inline horizontal version timeline
  // below the table (double-click still opens the editor). The selection
  // is local to this view — switching workspaces or refreshing clears it.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const filter = useMemo(
    () => ({
      workspaceId: activeWorkspaceId,
      status: statusFilter === "all" ? undefined : statusFilter,
      search: search.trim() || undefined,
    }),
    [activeWorkspaceId, statusFilter, search],
  );
  const { data, isLoading, error, refresh } = useQuotesList(filter);
  const mutations = useQuoteMutations();

  // Status counts derived from the unfiltered set (we re-fetch with filter,
  // but for the summary tiles we want the count of *visible* matches across
  // each status — this gives a quick read of the workspace state).
  const statusCounts = useMemo(() => {
    const counts: Record<QuoteStatus, number> = {
      draft: 0,
      sent: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      cancelled: 0,
    };
    for (const row of data) counts[row.status] += 1;
    return counts;
  }, [data]);

  const handleExportPdf = async (row: QuoteRow) => {
    if (!window.bukowskiQuotes) return;
    try {
      const result = await window.bukowskiQuotes.exportPdf(activeWorkspaceId, row.id);
      if (result.saved) {
        toast.success(t("finance.quotes.toasts.pdfReady"), result.summary ?? t("finance.quotes.toasts.pdfSaved"));
      } else {
        toast.info(t("finance.quotes.toasts.exportCancelled"), t("finance.quotes.toasts.exportCancelledBody"));
      }
    } catch (err) {
      toast.error(t("finance.quotes.toasts.exportFailed"), cleanIpcMessage(err, t("common.tryAgain")));
    }
  };

  const handleDuplicate = async (row: QuoteRow) => {
    try {
      const result = await mutations.duplicateQuote({
        commandId: newCommandId("dup"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        quoteId: row.id,
      });
      toast.success(
        t("finance.quotes.toasts.duplicatedTitle", { number: result.quoteNumber }),
        t("finance.quotes.toasts.duplicatedBody"),
      );
      navigate(`/finance/quotes/${result.quoteId}`);
    } catch (err) {
      toast.error(t("finance.quotes.toasts.duplicateFailed"), cleanIpcMessage(err, t("common.tryAgain")));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await mutations.deleteQuote({
        commandId: newCommandId("del"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        quoteId: pendingDelete.id,
      });
      toast.success(
        t("finance.quotes.toasts.deletedTitle", { number: pendingDelete.quoteNumber }),
        t("finance.quotes.toasts.deletedBody"),
      );
      setPendingDelete(null);
      refresh();
    } catch (err) {
      toast.error(t("finance.quotes.toasts.deleteFailed"), cleanIpcMessage(err, t("common.tryAgain")));
    } finally {
      setIsDeleting(false);
    }
  };

  const isDeletable = (row: QuoteRow) =>
    row.status === "draft" || row.status === "cancelled" || row.status === "rejected";
  const quoteStatusLabel = (status: QuoteStatus | "all") =>
    status === "all" ? t("finance.quotes.filters.all") : t(`finance.quotes.status.${status}`, { defaultValue: statusLabel(status) });

  const columns = useMemo(
    () => [
      {
        key: "number",
        label: t("finance.quotes.columns.quoteNumber"),
        render: (row: QuoteRow) => (
          <span className="quotes-list-number-cell">
            <Link className="quotes-list-number" to={`/finance/quotes/${row.id}`}>
              {row.quoteNumber}
            </Link>
            {row.createdByActorType === "agent" ? <AgentCreatedBadge variant="table" /> : null}
          </span>
        ),
      },
      {
        key: "client",
        label: t("finance.quotes.columns.client"),
        render: (row: QuoteRow) => (
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
        label: t("finance.quotes.columns.projectProduction"),
        render: (row: QuoteRow) =>
          row.projectNameSnapshot || row.productionName || "—",
      },
      {
        key: "packageTitle",
        label: t("finance.quotes.columns.packageTitle"),
        render: (row: QuoteRow) =>
          row.packageTitle ? (
            <span className="quotes-list-package">{row.packageTitle}</span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        key: "date",
        label: t("finance.quotes.columns.date"),
        render: (row: QuoteRow) => row.quoteDate,
      },
      {
        key: "validUntil",
        label: t("finance.quotes.columns.validUntil"),
        render: (row: QuoteRow) => (
          <span className={row.status === "expired" ? "text-muted" : ""}>{row.validUntil}</span>
        ),
      },
      {
        key: "total",
        label: t("finance.quotes.columns.total"),
        align: "right" as const,
        render: (row: QuoteRow) => (
          <div className="cell-stack" style={{ alignItems: "flex-end" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(row.totalAmount, row.currency, language)}
            </strong>
            {row.currency !== row.baseCurrency ? (
              <small className="text-muted">
                ≈ {formatCurrency(row.baseCurrencyTotalAmount, row.baseCurrency, language)}
              </small>
            ) : null}
          </div>
        ),
      },
      {
        key: "status",
        label: t("finance.quotes.columns.status"),
        render: (row: QuoteRow) => (
          <StatusBadge tone={statusTone(row.status)}>{quoteStatusLabel(row.status)}</StatusBadge>
        ),
      },
      {
        key: "actions",
        label: "",
        render: (row: QuoteRow) => (
          <div className="quotes-list-actions">
            <button
              aria-label={t("finance.quotes.actions.editAria", { number: row.quoteNumber })}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigate(`/finance/quotes/${row.id}`);
              }}
              title={t("finance.quotes.actions.edit")}
              type="button"
            >
              <Pencil size={13} />
            </button>
            <button
              aria-label={t("finance.quotes.actions.exportAria", { number: row.quoteNumber })}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleExportPdf(row);
              }}
              title={t("finance.quotes.actions.exportPdf")}
              type="button"
            >
              <Download size={13} />
            </button>
            <button
              aria-label={t("finance.quotes.actions.duplicateAria", { number: row.quoteNumber })}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleDuplicate(row);
              }}
              title={t("finance.quotes.actions.duplicate")}
              type="button"
            >
              <Copy size={13} />
            </button>
            <button
              aria-label={t("finance.quotes.actions.deleteAria", { number: row.quoteNumber })}
              className="row-icon-button row-icon-button-danger"
              disabled={!isDeletable(row)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isDeletable(row)) setPendingDelete(row);
              }}
              title={
                isDeletable(row)
                  ? t("finance.quotes.actions.delete")
                  : t("finance.quotes.actions.deleteDisabled")
              }
              type="button"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspaceId, language, t],
  );

  const totalShown = data.length;

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <SectionHeader
          eyebrow={t("finance.title")}
          title={t("finance.quotes.title")}
          titleTone="accent"
        />
        <button
          className="action-primary-button"
          onClick={() => navigate("/finance/quotes/new")}
          type="button"
        >
          <Plus size={13} />
          <span>{t("finance.quotes.newQuote")}</span>
        </button>
      </div>

      {totalShown > 0 ? (
        <SurfaceCard className="quotes-summary-card">
          <div className="quotes-summary-grid">
            <button
              className={`quotes-summary-tile${statusFilter === "all" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("all")}
              type="button"
            >
              <span className="quotes-summary-tile-label">{t("finance.quotes.summary.total")}</span>
              <strong className="quotes-summary-tile-value">{totalShown}</strong>
            </button>
            {(["draft", "sent", "approved", "rejected", "expired", "cancelled"] as QuoteStatus[]).map(
              (status) => (
                <button
                  className={`quotes-summary-tile quotes-summary-tile-${status}${
                    statusFilter === status ? " is-active" : ""
                  }`}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  <span className="quotes-summary-tile-label">{quoteStatusLabel(status)}</span>
                  <strong className="quotes-summary-tile-value">{statusCounts[status]}</strong>
                </button>
              ),
            )}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard>
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="compact-filter-field quotes-status-filter">
            <span>{t("finance.quotes.filters.status")}</span>
            <select
              className="compact-filter-select"
              onChange={(event) => setStatusFilter(event.target.value as QuoteStatus | "all")}
              value={statusFilter}
            >
              {allStatuses.map((s) => (
                <option key={s} value={s}>
                  {quoteStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <input
            className="field-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("finance.quotes.searchPlaceholder")}
            style={{ minWidth: 240, marginLeft: "auto" }}
            value={search}
          />
        </div>

        {isLoading && data.length === 0 ? (
          <TableSkeleton rows={6} />
        ) : data.length === 0 ? (
          <GuidedEmptyState
            actionLabel={search || statusFilter !== "all" ? undefined : t("finance.quotes.empty.createFirst")}
            onAction={search || statusFilter !== "all" ? undefined : () => navigate("/finance/quotes/new")}
            secondaryActionLabel={search || statusFilter !== "all" ? t("finance.quotes.empty.clearFilters") : undefined}
            onSecondaryAction={
              search || statusFilter !== "all"
                ? () => {
                    setSearch("");
                    setStatusFilter("all");
                  }
                : undefined
            }
            title={search || statusFilter !== "all" ? t("finance.quotes.empty.noMatchesTitle") : t("finance.quotes.empty.noQuotesTitle")}
            body={
              search || statusFilter !== "all"
                ? t("finance.quotes.empty.noMatchesBody")
                : t("finance.quotes.empty.noQuotesBody")
            }
          />
        ) : (
          <DataTable<QuoteRow>
            columns={columns}
            rows={data}
            persistKey="quotes-list-v1"
            getRowId={(row) => row.id}
            activeRowId={expandedRowId}
            onRowClick={(row) =>
              setExpandedRowId((current) => (current === row.id ? null : row.id))
            }
            onRowDoubleClick={(row) => navigate(`/finance/quotes/${row.id}`)}
          />
        )}

        {expandedRowId
          ? (() => {
              const expanded = data.find((row) => row.id === expandedRowId);
              if (!expanded) return null;
              return (
                <QuoteVersionsStrip
                  quoteId={expanded.id}
                  workspaceId={activeWorkspaceId}
                  quoteLabel={expanded.quoteNumber}
                />
              );
            })()
          : null}

        {error ? <div className="form-inline-error">{error}</div> : null}
      </SurfaceCard>

      <ConfirmDialog
        body={
          pendingDelete ? (
            <span>
              {t("finance.quotes.deleteDialog.bodyPrefix")} <strong>{pendingDelete.quoteNumber}</strong>{" "}
              {t("finance.quotes.deleteDialog.bodyFor")} <strong>{pendingDelete.clientNameSnapshot}</strong>?{" "}
              {t("finance.quotes.deleteDialog.bodySuffix")}
            </span>
          ) : (
            ""
          )
        }
        cancelLabel={t("finance.quotes.deleteDialog.keep")}
        confirmLabel={isDeleting ? t("finance.quotes.deleteDialog.deleting") : t("finance.quotes.deleteDialog.deletePermanently")}
        isOpen={pendingDelete !== null}
        isSubmitting={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t("finance.quotes.deleteDialog.title")}
        tone="danger"
      />
    </div>
  );
};

export default QuotesPage;
