import { ArrowLeft, Ban, CheckCircle2, CreditCard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { InvoiceStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";

import { formatCurrency, newCommandId } from "./quoteHelpers";
import { useInvoiceDetail, useInvoiceMutations } from "./useInvoiceData";

const today = () => new Date().toISOString().slice(0, 10);

const cleanIpcMessage = (err: unknown, fallback: string) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method.*?Error:\s*/i, "")
    : fallback;

const statusTone = (status: InvoiceStatus) => {
  if (status === "paid") return "success" as const;
  if (status === "issued" || status === "partially_paid") return "warning" as const;
  if (status === "cancelled" || status === "void") return "critical" as const;
  return "neutral" as const;
};

export const InvoiceDetailPage = () => {
  const { t } = useTranslation();
  const { language } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const { invoiceId } = useParams();
  const { activeWorkspaceId } = useWorkspace();
  const { data: invoice, isLoading, error, refresh } = useInvoiceDetail(activeWorkspaceId, invoiceId);
  const mutations = useInvoiceMutations();

  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  useEffect(() => {
    if (!invoice || paymentAmount) return;
    if (invoice.outstandingAmount > 0) {
      setPaymentAmount(invoice.outstandingAmount.toFixed(2));
    }
  }, [invoice, paymentAmount]);

  const statusLabel = (status: InvoiceStatus) =>
    t(`finance.invoices.status.${status}`, { defaultValue: status });

  const canIssue = invoice?.status === "draft";
  const canCancel = invoice?.status === "draft" || invoice?.status === "issued";
  const canRecordPayment = invoice?.status === "issued" || invoice?.status === "partially_paid";
  const parsedPaymentAmount = Number(paymentAmount);
  const paymentInvalid =
    !invoice ||
    !canRecordPayment ||
    !Number.isFinite(parsedPaymentAmount) ||
    parsedPaymentAmount <= 0 ||
    parsedPaymentAmount > invoice.outstandingAmount + 0.005;

  const totals = useMemo(() => {
    if (!invoice) return [];
    return [
      [t("finance.invoices.detail.totals.subtotal"), invoice.subtotalAmount],
      [t("finance.invoices.detail.totals.discount"), -invoice.discountAmount],
      [t("finance.invoices.detail.totals.tax"), invoice.taxAmount],
      [t("finance.invoices.detail.totals.total"), invoice.totalAmount],
      [t("finance.invoices.detail.totals.paid"), invoice.paidAmount],
      [t("finance.invoices.detail.totals.outstanding"), invoice.outstandingAmount],
    ] as const;
  }, [invoice, t]);

  const handleIssue = async () => {
    if (!invoice) return;
    setIsSubmitting(true);
    try {
      const result = await mutations.issueInvoice({
        commandId: newCommandId("invoice-issue"),
        workspaceId: activeWorkspaceId,
        invoiceId: invoice.id,
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(t("finance.invoices.toasts.issued"), result.summary);
      setConfirmIssueOpen(false);
      refresh();
    } catch (err) {
      toast.error(
        t("finance.invoices.toasts.issueFailed"),
        cleanIpcMessage(err, t("finance.invoices.toasts.tryAgain")),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!invoice) return;
    setIsSubmitting(true);
    try {
      const result = await mutations.cancelInvoice({
        commandId: newCommandId("invoice-cancel"),
        workspaceId: activeWorkspaceId,
        invoiceId: invoice.id,
        actorType: "user",
        sourceChannel: "desktop",
        reason: cancelReason.trim() || null,
      });
      toast.success(t("finance.invoices.toasts.cancelled"), result.summary);
      setConfirmCancelOpen(false);
      refresh();
    } catch (err) {
      toast.error(
        t("finance.invoices.toasts.cancelFailed"),
        cleanIpcMessage(err, t("finance.invoices.toasts.tryAgain")),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!invoice || paymentInvalid) return;
    setIsSubmitting(true);
    try {
      const result = await mutations.recordPayment({
        commandId: newCommandId("invoice-payment"),
        workspaceId: activeWorkspaceId,
        invoiceId: invoice.id,
        actorType: "user",
        sourceChannel: "desktop",
        paidAt: paymentDate,
        amount: parsedPaymentAmount,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        paymentMethod: paymentMethod.trim() || null,
        reference: paymentReference.trim() || null,
        notes: paymentNotes.trim() || null,
      });
      toast.success(t("finance.invoices.toasts.paymentRecorded"), result.summary);
      setPaymentAmount("");
      setPaymentMethod("");
      setPaymentReference("");
      setPaymentNotes("");
      refresh();
    } catch (err) {
      toast.error(
        t("finance.invoices.toasts.paymentFailed"),
        cleanIpcMessage(err, t("finance.invoices.toasts.tryAgain")),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading && !invoice) {
    return (
      <div className="page-stack">
        <TableSkeleton rows={7} />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="page-stack">
        <Link className="ghost-control" to="/finance/invoices">
          <ArrowLeft size={13} />
          <span>{t("finance.invoices.detail.back")}</span>
        </Link>
        <GuidedEmptyState
          actionLabel={t("finance.invoices.detail.back")}
          body={error ?? t("finance.invoices.detail.notFoundBody")}
          onAction={() => navigate("/finance/invoices")}
          title={t("finance.invoices.detail.notFoundTitle")}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-stack-row">
        <div style={{ display: "grid", gap: 10 }}>
          <Link className="ghost-control" style={{ justifySelf: "start" }} to="/finance/invoices">
            <ArrowLeft size={13} />
            <span>{t("finance.invoices.detail.back")}</span>
          </Link>
          <SectionHeader
            eyebrow={t("finance.invoices.detail.eyebrow")}
            title={t("finance.invoices.detail.title", { number: invoice.invoiceNumber })}
            titleTone="accent"
          />
        </div>
        <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <StatusBadge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</StatusBadge>
          <button className="ghost-control" disabled={!canIssue} onClick={() => setConfirmIssueOpen(true)} type="button">
            <CheckCircle2 size={13} />
            <span>{t("finance.invoices.detail.actions.issue")}</span>
          </button>
          <button
            className="ghost-control is-danger"
            disabled={!canCancel}
            onClick={() => setConfirmCancelOpen(true)}
            type="button"
          >
            <Ban size={13} />
            <span>{t("finance.invoices.detail.actions.cancel")}</span>
          </button>
        </div>
      </div>

      <div className="quotes-summary-grid">
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">{t("finance.invoices.columns.ncf")}</span>
          <strong className="quotes-summary-tile-value">{invoice.ncf ?? t("finance.invoices.detail.notIssued")}</strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">{t("finance.invoices.detail.client")}</span>
          <strong className="quotes-summary-tile-value">{invoice.clientNameSnapshot}</strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">{t("finance.invoices.columns.total")}</span>
          <strong className="quotes-summary-tile-value">
            {formatCurrency(invoice.totalAmount, invoice.currency, language)}
          </strong>
        </SurfaceCard>
        <SurfaceCard className="quotes-summary-tile">
          <span className="quotes-summary-tile-label">{t("finance.invoices.detail.totals.outstanding")}</span>
          <strong className="quotes-summary-tile-value">
            {formatCurrency(invoice.outstandingAmount, invoice.currency, language)}
          </strong>
        </SurfaceCard>
      </div>

      <div className="asset-workbench-layout" style={{ alignItems: "start" }}>
        <div className="page-stack">
          <SurfaceCard>
            <div className="surface-card-header">
              <div>
                <h3>{t("finance.invoices.detail.document")}</h3>
                <p>{invoice.projectNameSnapshot || invoice.productionName || invoice.productionCompanyNameSnapshot || "—"}</p>
              </div>
            </div>
            <div className="settings-two-column-grid">
              <label className="field-label">
                <span>{t("finance.invoices.columns.issueDate")}</span>
                <input className="field-input" readOnly value={invoice.issueDate} />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.columns.dueDate")}</span>
                <input className="field-input" readOnly value={invoice.dueDate ?? "—"} />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.productionCompany")}</span>
                <input className="field-input" readOnly value={invoice.productionCompanyNameSnapshot ?? "—"} />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.rnc")}</span>
                <input className="field-input" readOnly value={invoice.clientRncSnapshot ?? "—"} />
              </label>
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="surface-card-header">
              <div>
                <h3>{t("finance.invoices.detail.items")}</h3>
                <p>{t("finance.invoices.detail.itemsBody", { count: invoice.items.length })}</p>
              </div>
            </div>
            <div className="quote-line-items-list">
              {invoice.items.map((item) => (
                <div className="quote-line-item-row" key={item.id}>
                  <div className="cell-stack">
                    <strong>{item.title}</strong>
                    {item.description ? <small className="text-muted">{item.description}</small> : null}
                  </div>
                  <span className="text-muted">x{item.quantity}</span>
                  <strong>{formatCurrency(item.lineTotal, invoice.currency, language)}</strong>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="surface-card-header">
              <div>
                <h3>{t("finance.invoices.detail.payments")}</h3>
                <p>{t("finance.invoices.detail.paymentsBody", { count: invoice.payments.length })}</p>
              </div>
            </div>
            {invoice.payments.length ? (
              <div className="quote-line-items-list">
                {invoice.payments.map((payment) => (
                  <div className="quote-line-item-row" key={payment.id}>
                    <div className="cell-stack">
                      <strong>{formatCurrency(payment.amount, payment.currency, language)}</strong>
                      <small className="text-muted">{payment.paidAt}</small>
                    </div>
                    <span className="text-muted">{payment.paymentMethod ?? "—"}</span>
                    <span className="text-muted">{payment.reference ?? "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">{t("finance.invoices.detail.noPayments")}</p>
            )}
          </SurfaceCard>
        </div>

        <aside className="page-stack">
          <SurfaceCard>
            <div className="surface-card-header">
              <div>
                <h3>{t("finance.invoices.detail.totals.title")}</h3>
                <p>{invoice.currency}</p>
              </div>
            </div>
            <div className="settings-mini-list">
              {totals.map(([label, value]) => (
                <div className="settings-mini-row" key={label}>
                  <span>{label}</span>
                  <strong>{formatCurrency(value, invoice.currency, language)}</strong>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="surface-card-header">
              <div>
                <h3>{t("finance.invoices.detail.recordPayment.title")}</h3>
                <p>{t("finance.invoices.detail.recordPayment.body")}</p>
              </div>
            </div>
            <div className="settings-form-stack">
              <label className="field-label">
                <span>{t("finance.invoices.detail.recordPayment.amount")}</span>
                <input
                  className="field-input"
                  disabled={!canRecordPayment}
                  min="0"
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  step="0.01"
                  type="number"
                  value={paymentAmount}
                />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.recordPayment.date")}</span>
                <input
                  className="field-input"
                  disabled={!canRecordPayment}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  type="date"
                  value={paymentDate}
                />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.recordPayment.method")}</span>
                <input
                  className="field-input"
                  disabled={!canRecordPayment}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  value={paymentMethod}
                />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.recordPayment.reference")}</span>
                <input
                  className="field-input"
                  disabled={!canRecordPayment}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  value={paymentReference}
                />
              </label>
              <label className="field-label">
                <span>{t("finance.invoices.detail.recordPayment.notes")}</span>
                <textarea
                  className="field-input"
                  disabled={!canRecordPayment}
                  onChange={(event) => setPaymentNotes(event.target.value)}
                  rows={3}
                  value={paymentNotes}
                />
              </label>
              <button
                className="ghost-control is-active"
                disabled={paymentInvalid || isSubmitting}
                onClick={() => void handleRecordPayment()}
                type="button"
              >
                <CreditCard size={13} />
                <span>{t("finance.invoices.detail.actions.recordPayment")}</span>
              </button>
            </div>
          </SurfaceCard>
        </aside>
      </div>

      <ConfirmDialog
        body={t("finance.invoices.detail.issueConfirm.body")}
        confirmLabel={t("finance.invoices.detail.actions.issue")}
        isOpen={confirmIssueOpen}
        isSubmitting={isSubmitting}
        onCancel={() => setConfirmIssueOpen(false)}
        onConfirm={handleIssue}
        title={t("finance.invoices.detail.issueConfirm.title")}
      />

      <ConfirmDialog
        body={
          <div className="settings-form-stack">
            <p>{t("finance.invoices.detail.cancelConfirm.body")}</p>
            <label className="field-label">
              <span>{t("finance.invoices.detail.cancelConfirm.reason")}</span>
              <textarea
                className="field-input"
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                value={cancelReason}
              />
            </label>
          </div>
        }
        confirmLabel={t("finance.invoices.detail.actions.cancel")}
        isOpen={confirmCancelOpen}
        isSubmitting={isSubmitting}
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={handleCancel}
        title={t("finance.invoices.detail.cancelConfirm.title")}
        tone="danger"
      />
    </div>
  );
};

export default InvoiceDetailPage;
