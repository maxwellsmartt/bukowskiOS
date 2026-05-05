import { Copy, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { QuoteRow, QuoteStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";

import {
  formatCurrency,
  newCommandId,
  statusLabel,
  statusTone,
} from "./quoteHelpers";
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

const cleanIpcMessage = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
    : "Try again in a moment.";

export const QuotesPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<QuoteRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
        toast.success("PDF ready", result.summary ?? "We saved your quote PDF.");
      } else {
        toast.info("Export cancelled", "Nothing was saved — try again when you're ready.");
      }
    } catch (err) {
      toast.error("We couldn't export the PDF", cleanIpcMessage(err));
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
        `Duplicated as ${result.quoteNumber}`,
        "We copied the items into a fresh draft — adjust and save when ready.",
      );
      navigate(`/finance/quotes/${result.quoteId}`);
    } catch (err) {
      toast.error("We couldn't duplicate that quote", cleanIpcMessage(err));
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
        `Quote ${pendingDelete.quoteNumber} deleted`,
        "It's gone — there's no undo. Use Cancel instead next time if you need an audit trail.",
      );
      setPendingDelete(null);
      refresh();
    } catch (err) {
      toast.error("We couldn't delete this quote", cleanIpcMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const isDeletable = (row: QuoteRow) =>
    row.status === "draft" || row.status === "cancelled" || row.status === "rejected";

  const columns = useMemo(
    () => [
      {
        key: "number",
        label: "Quote #",
        render: (row: QuoteRow) => (
          <Link className="quotes-list-number" to={`/finance/quotes/${row.id}`}>
            {row.quoteNumber}
          </Link>
        ),
      },
      {
        key: "client",
        label: "Client",
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
        label: "Project / Production",
        render: (row: QuoteRow) =>
          row.projectNameSnapshot || row.productionName || row.packageTitle || "—",
      },
      {
        key: "date",
        label: "Date",
        render: (row: QuoteRow) => row.quoteDate,
      },
      {
        key: "validUntil",
        label: "Valid until",
        render: (row: QuoteRow) => (
          <span className={row.status === "expired" ? "text-muted" : ""}>{row.validUntil}</span>
        ),
      },
      {
        key: "total",
        label: "Total",
        align: "right" as const,
        render: (row: QuoteRow) => (
          <div className="cell-stack" style={{ alignItems: "flex-end" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(row.totalAmount, row.currency)}
            </strong>
            {row.currency !== row.baseCurrency ? (
              <small className="text-muted">
                ≈ {formatCurrency(row.baseCurrencyTotalAmount, row.baseCurrency)}
              </small>
            ) : null}
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        render: (row: QuoteRow) => (
          <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>
        ),
      },
      {
        key: "actions",
        label: "",
        render: (row: QuoteRow) => (
          <div className="quotes-list-actions">
            <button
              aria-label={`Edit ${row.quoteNumber}`}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigate(`/finance/quotes/${row.id}`);
              }}
              title="Edit quote"
              type="button"
            >
              <Pencil size={13} />
            </button>
            <button
              aria-label={`Export PDF for ${row.quoteNumber}`}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleExportPdf(row);
              }}
              title="Export as PDF"
              type="button"
            >
              <Download size={13} />
            </button>
            <button
              aria-label={`Duplicate ${row.quoteNumber}`}
              className="row-icon-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleDuplicate(row);
              }}
              title="Duplicate as a new draft"
              type="button"
            >
              <Copy size={13} />
            </button>
            <button
              aria-label={`Delete ${row.quoteNumber}`}
              className="row-icon-button row-icon-button-danger"
              disabled={!isDeletable(row)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isDeletable(row)) setPendingDelete(row);
              }}
              title={
                isDeletable(row)
                  ? "Delete permanently"
                  : "Cancel the quote first (sent or approved quotes can't be deleted directly)"
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
    [activeWorkspaceId],
  );

  const totalShown = data.length;

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <SectionHeader
          eyebrow="Finance"
          title="Quotes"
          body="Client and project quotes in DOP, USD or EUR. The exchange rate is captured at quote creation so older quotes never change."
          titleTone="accent"
        />
        <button
          className="action-primary-button"
          onClick={() => navigate("/finance/quotes/new")}
          type="button"
        >
          <Plus size={13} />
          <span>New quote</span>
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
              <span className="quotes-summary-tile-label">Total</span>
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
                  <span className="quotes-summary-tile-label">{statusLabel(status)}</span>
                  <strong className="quotes-summary-tile-value">{statusCounts[status]}</strong>
                </button>
              ),
            )}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard>
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="filter-pill-row">
            {allStatuses.map((s) => (
              <button
                key={s}
                className={`filter-pill${statusFilter === s ? " is-active" : ""}`}
                onClick={() => setStatusFilter(s)}
                type="button"
              >
                {s === "all" ? "All" : statusLabel(s)}
              </button>
            ))}
          </div>
          <input
            className="field-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by number, client, project…"
            style={{ minWidth: 240, marginLeft: "auto" }}
            value={search}
          />
        </div>

        {isLoading && data.length === 0 ? (
          <TableSkeleton rows={6} />
        ) : data.length === 0 ? (
          <GuidedEmptyState
            actionLabel={search || statusFilter !== "all" ? undefined : "Create your first quote"}
            onAction={search || statusFilter !== "all" ? undefined : () => navigate("/finance/quotes/new")}
            secondaryActionLabel={search || statusFilter !== "all" ? "Clear filters" : undefined}
            onSecondaryAction={
              search || statusFilter !== "all"
                ? () => {
                    setSearch("");
                    setStatusFilter("all");
                  }
                : undefined
            }
            title={search || statusFilter !== "all" ? "No quotes match these filters" : "No quotes yet"}
            body={
              search || statusFilter !== "all"
                ? "Try widening the filter or clearing the search."
                : "Create a quote in DOP, USD or EUR. The exchange-rate snapshot is captured automatically so older quotes never change."
            }
          />
        ) : (
          <DataTable<QuoteRow>
            columns={columns}
            rows={data}
            persistKey="quotes-list-v1"
            getRowId={(row) => row.id}
            onRowDoubleClick={(row) => navigate(`/finance/quotes/${row.id}`)}
          />
        )}

        {error ? <p className="error-banner">{error}</p> : null}
      </SurfaceCard>

      <ConfirmDialog
        body={
          pendingDelete ? (
            <span>
              Delete quote <strong>{pendingDelete.quoteNumber}</strong> for{" "}
              <strong>{pendingDelete.clientNameSnapshot}</strong>? This is permanent — the items and
              version history will be removed.
            </span>
          ) : (
            ""
          )
        }
        cancelLabel="Keep it"
        confirmLabel={isDeleting ? "Deleting…" : "Delete permanently"}
        isOpen={pendingDelete !== null}
        isSubmitting={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this quote?"
        tone="danger"
      />
    </div>
  );
};

export default QuotesPage;
