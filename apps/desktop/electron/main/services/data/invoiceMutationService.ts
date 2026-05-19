import type { DatabaseSync } from "node:sqlite";

import type {
  CancelInvoiceCommand,
  CreateInvoiceCommand,
  InvoiceItemInput,
  InvoiceMutationResult,
  InvoiceStatus,
  IssueInvoiceCommand,
  QuoteDetail,
  RecordInvoicePaymentCommand,
  UpdateInvoiceCommand,
} from "@contracts";

import { calculateQuote } from "./quoteCalculationService";

const defaultActorUserId = "user-ops";

const buildFailedCommandMessage = (label: string, previousError?: string | null) =>
  previousError
    ? `This command id already failed once for ${label}: ${previousError}`
    : `This command id already failed once for ${label}. Generate a new action and retry.`;

const createCommandReceiptHelpers = (db: DatabaseSync) => ({
  getExistingReceipt(commandId: string) {
    return db
      .prepare(
        `SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ? LIMIT 1`,
      )
      .get(commandId) as { outcome_status: string; error_message: string | null } | undefined;
  },
  insertReceipt: db.prepare(
    `
      INSERT OR REPLACE INTO command_receipts (
        command_id, workspace_id, actor_user_id, actor_type, source_channel,
        executed_at, outcome_status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ),
});

const enqueueOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  syncId: string,
  now: string,
) => {
  db.prepare(
    `
      INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type,
        payload_json, status, attempt_count, last_error, next_retry_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)
    `,
  ).run(syncId, workspaceId, entityType, entityId, JSON.stringify(payload), now, now, now);
};

const padSequence = (seq: number) => seq.toString().padStart(4, "0");

const persistInvoiceItems = (
  db: DatabaseSync,
  workspaceId: string,
  invoiceId: string,
  items: InvoiceItemInput[],
  breakdowns: ReturnType<typeof calculateQuote>["itemBreakdowns"],
  now: string,
) => {
  db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(invoiceId);
  const insert = db.prepare(`
    INSERT INTO invoice_items (
      id, workspace_id, invoice_id, sort_order, quantity, title, description,
      duration_value, duration_unit, unit_price, line_subtotal,
      discount_rate, discount_amount, tax_behavior, tax_rate, tax_amount,
      line_total, notes, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  items.forEach((item, index) => {
    const breakdown = breakdowns[index]!;
    const itemId = `${invoiceId}-item-${item.sortOrder.toString().padStart(3, "0")}-${index}`;
    insert.run(
      itemId,
      workspaceId,
      invoiceId,
      item.sortOrder,
      item.quantity,
      item.title.trim(),
      item.description?.trim() || null,
      item.durationValue ?? null,
      item.durationUnit ?? null,
      item.unitPrice,
      breakdown.lineSubtotal,
      item.discountRate ?? null,
      breakdown.discountAmount,
      item.taxBehavior,
      item.taxRate ?? null,
      breakdown.taxAmount,
      breakdown.lineTotal,
      item.notes?.trim() || null,
      null,
      now,
      now,
    );
  });
};

/**
 * Compute the issue date's due date based on payment terms. The result
 * is null when terms is zero (cash-on-issue) so the UI doesn't display
 * a redundant "Due {{issueDate}}".
 */
const computeDueDate = (issueDate: string, paymentTermsDays?: number | null): string | null => {
  if (!paymentTermsDays || paymentTermsDays <= 0) return null;
  const base = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + paymentTermsDays);
  return base.toISOString().slice(0, 10);
};

export const createInvoiceMutationService = (db: DatabaseSync) => ({
  createInvoice(input: CreateInvoiceCommand): InvoiceMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      const found = db
        .prepare("SELECT id, invoice_number FROM invoices WHERE workspace_id = ? AND id = ?")
        .get(input.workspaceId, `invoice-${input.commandId}`) as
        | { id: string; invoice_number: string }
        | undefined;
      return {
        commandId: input.commandId,
        invoiceId: found?.id ?? `invoice-${input.commandId}`,
        invoiceNumber: found?.invoice_number ?? "—",
        repeated: true,
        summary: "Invoice was already created for this command.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("invoice creation", existing.error_message));
    }

    if (input.items.length === 0) throw new Error("An invoice needs at least one line item.");

    const invoiceId = `invoice-${input.commandId}`;
    const dueDate = computeDueDate(input.issueDate, input.paymentTermsDays ?? null);
    const totals = calculateQuote({
      currency: input.currency,
      baseCurrency: input.baseCurrency,
      exchangeRate: input.exchangeRate,
      taxProfile: input.taxProfile,
      itbisRate: input.itbisRate,
      taxAddedToTotal: input.taxAddedToTotal,
      discountRate: input.discountRate ?? null,
      discountAmount: input.discountAmount ?? null,
      items: input.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        durationValue: item.durationValue ?? null,
        discountRate: item.discountRate ?? null,
        discountAmount: item.discountAmount ?? null,
        taxBehavior: item.taxBehavior,
        taxRate: item.taxRate ?? null,
      })),
    });

    const now = new Date().toISOString();
    const year = new Date(`${input.issueDate}T00:00:00Z`).getUTCFullYear();

    db.exec("BEGIN IMMEDIATE");
    try {
      const seqRow = db
        .prepare(
          "SELECT COALESCE(MAX(invoice_sequence), 0) AS max_seq FROM invoices WHERE workspace_id = ? AND invoice_year = ?",
        )
        .get(input.workspaceId, year) as { max_seq: number };
      const nextSeq = (seqRow?.max_seq ?? 0) + 1;
      const invoiceNumber = `${year}-${padSequence(nextSeq)}`;

      db.prepare(
        `
          INSERT INTO invoices (
            id, workspace_id, source_quote_id,
            invoice_number, invoice_year, invoice_sequence, status,
            issue_date, due_date, payment_terms_days,
            client_id, client_name_snapshot, client_rnc_snapshot,
            production_company_id, production_company_name_snapshot, production_pur_snapshot,
            workspace_sirecine_snapshot, attention_name, attention_phone,
            project_id, project_name_snapshot, production_name,
            description, package_title,
            currency, base_currency, exchange_rate,
            exchange_rate_source, exchange_rate_type, exchange_rate_effective_date,
            exchange_rate_snapshot_json,
            tax_profile, itbis_rate, tax_added_to_total, tax_notes,
            subtotal_amount, discount_amount, discount_rate, tax_amount,
            total_amount, base_currency_total_amount,
            paid_amount, outstanding_amount,
            observations, created_by_user_id, updated_by_user_id,
            created_by_actor_type, source_channel,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?,
            ?, ?, ?, 'draft',
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?
          )
        `,
      ).run(
        invoiceId,
        input.workspaceId,
        input.sourceQuoteId ?? null,
        invoiceNumber,
        year,
        nextSeq,
        input.issueDate,
        dueDate,
        input.paymentTermsDays ?? 0,
        input.clientId ?? null,
        input.clientNameSnapshot.trim(),
        input.clientRncSnapshot?.trim() || null,
        input.productionCompanyId ?? null,
        input.productionCompanyNameSnapshot?.trim() || null,
        input.productionPurSnapshot?.trim() || null,
        input.workspaceSirecineSnapshot?.trim() || null,
        input.attentionName?.trim() || null,
        input.attentionPhone?.trim() || null,
        input.projectId ?? null,
        input.projectNameSnapshot?.trim() || null,
        input.productionName?.trim() || null,
        input.description?.trim() || null,
        input.packageTitle?.trim() || null,
        input.currency.toUpperCase(),
        input.baseCurrency.toUpperCase(),
        input.exchangeRate,
        input.exchangeRateSource,
        input.exchangeRateType,
        input.exchangeRateEffectiveDate ?? null,
        JSON.stringify({
          source: input.exchangeRateSource,
          rateType: input.exchangeRateType,
          rate: input.exchangeRate,
          effectiveDate: input.exchangeRateEffectiveDate ?? null,
        }),
        input.taxProfile,
        input.itbisRate,
        input.taxAddedToTotal ? 1 : 0,
        input.taxNotes?.trim() || null,
        totals.subtotal,
        totals.discountAmount,
        input.discountRate ?? null,
        totals.taxAmount,
        totals.total,
        totals.baseCurrencyTotal,
        0,
        totals.total,
        input.observations?.trim() || null,
        defaultActorUserId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        now,
      );

      persistInvoiceItems(db, input.workspaceId, invoiceId, input.items, totals.itemBreakdowns, now);

      enqueueOutbox(
        db,
        input.workspaceId,
        "invoice",
        invoiceId,
        { kind: "invoice.create", invoiceId, workspaceId: input.workspaceId },
        `invoice-create-${invoiceId}`,
        now,
      );

      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        invoiceId,
        invoiceNumber,
        repeated: false,
        summary: `Invoice ${invoiceNumber} drafted for ${input.clientNameSnapshot.trim()}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw error;
    }
  },

  updateInvoice(input: UpdateInvoiceCommand): InvoiceMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: "—",
        repeated: true,
        summary: "Invoice update was already applied.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("invoice update", existing.error_message));
    }

    if (input.items.length === 0) throw new Error("An invoice needs at least one line item.");

    const current = db
      .prepare("SELECT id, invoice_number, status FROM invoices WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.invoiceId) as
      | { id: string; invoice_number: string; status: InvoiceStatus }
      | undefined;
    if (!current) throw new Error("Invoice not found.");
    if (current.status !== "draft") {
      throw new Error(
        `Only draft invoices can be edited (current status: ${current.status}). Cancel and recreate if needed.`,
      );
    }

    const totals = calculateQuote({
      currency: input.currency,
      baseCurrency: input.baseCurrency,
      exchangeRate: input.exchangeRate,
      taxProfile: input.taxProfile,
      itbisRate: input.itbisRate,
      taxAddedToTotal: input.taxAddedToTotal,
      discountRate: input.discountRate ?? null,
      discountAmount: input.discountAmount ?? null,
      items: input.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        durationValue: item.durationValue ?? null,
        discountRate: item.discountRate ?? null,
        discountAmount: item.discountAmount ?? null,
        taxBehavior: item.taxBehavior,
        taxRate: item.taxRate ?? null,
      })),
    });
    const dueDate = computeDueDate(input.issueDate, input.paymentTermsDays ?? null);
    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          UPDATE invoices SET
            issue_date = ?, due_date = ?, payment_terms_days = ?,
            client_id = ?, client_name_snapshot = ?, client_rnc_snapshot = ?,
            production_company_id = ?, production_company_name_snapshot = ?, production_pur_snapshot = ?,
            workspace_sirecine_snapshot = ?, attention_name = ?, attention_phone = ?,
            project_id = ?, project_name_snapshot = ?, production_name = ?,
            description = ?, package_title = ?,
            currency = ?, base_currency = ?, exchange_rate = ?,
            exchange_rate_source = ?, exchange_rate_type = ?, exchange_rate_effective_date = ?,
            exchange_rate_snapshot_json = ?,
            tax_profile = ?, itbis_rate = ?, tax_added_to_total = ?, tax_notes = ?,
            subtotal_amount = ?, discount_amount = ?, discount_rate = ?,
            tax_amount = ?, total_amount = ?, base_currency_total_amount = ?,
            outstanding_amount = ?,
            observations = ?, updated_by_user_id = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `,
      ).run(
        input.issueDate,
        dueDate,
        input.paymentTermsDays ?? 0,
        input.clientId ?? null,
        input.clientNameSnapshot.trim(),
        input.clientRncSnapshot?.trim() || null,
        input.productionCompanyId ?? null,
        input.productionCompanyNameSnapshot?.trim() || null,
        input.productionPurSnapshot?.trim() || null,
        input.workspaceSirecineSnapshot?.trim() || null,
        input.attentionName?.trim() || null,
        input.attentionPhone?.trim() || null,
        input.projectId ?? null,
        input.projectNameSnapshot?.trim() || null,
        input.productionName?.trim() || null,
        input.description?.trim() || null,
        input.packageTitle?.trim() || null,
        input.currency.toUpperCase(),
        input.baseCurrency.toUpperCase(),
        input.exchangeRate,
        input.exchangeRateSource,
        input.exchangeRateType,
        input.exchangeRateEffectiveDate ?? null,
        JSON.stringify({
          source: input.exchangeRateSource,
          rateType: input.exchangeRateType,
          rate: input.exchangeRate,
          effectiveDate: input.exchangeRateEffectiveDate ?? null,
        }),
        input.taxProfile,
        input.itbisRate,
        input.taxAddedToTotal ? 1 : 0,
        input.taxNotes?.trim() || null,
        totals.subtotal,
        totals.discountAmount,
        input.discountRate ?? null,
        totals.taxAmount,
        totals.total,
        totals.baseCurrencyTotal,
        totals.total, // outstanding follows total for drafts
        input.observations?.trim() || null,
        defaultActorUserId,
        now,
        input.invoiceId,
        input.workspaceId,
      );

      persistInvoiceItems(db, input.workspaceId, input.invoiceId, input.items, totals.itemBreakdowns, now);

      enqueueOutbox(
        db,
        input.workspaceId,
        "invoice",
        input.invoiceId,
        { kind: "invoice.update", invoiceId: input.invoiceId, workspaceId: input.workspaceId },
        `invoice-update-${input.commandId}`,
        now,
      );

      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: current.invoice_number,
        repeated: false,
        summary: `Invoice ${current.invoice_number} updated.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw error;
    }
  },

  /**
   * Consume the workspace's next NCF and flip the invoice to `issued`.
   * Wrapped in `BEGIN IMMEDIATE` so the sequence increment is atomic —
   * two concurrent issuances cannot collide on the same NCF.
   */
  issueInvoice(input: IssueInvoiceCommand): InvoiceMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: "—",
        repeated: true,
        summary: "Invoice was already issued for this command.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("invoice issue", existing.error_message));
    }

    const current = db
      .prepare("SELECT id, invoice_number, status FROM invoices WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.invoiceId) as
      | { id: string; invoice_number: string; status: InvoiceStatus }
      | undefined;
    if (!current) throw new Error("Invoice not found.");
    if (current.status !== "draft") {
      throw new Error(`Only draft invoices can be issued (current status: ${current.status}).`);
    }

    const now = new Date().toISOString();

    db.exec("BEGIN IMMEDIATE");
    try {
      const series = db
        .prepare(
          `SELECT ncf_series_active, ncf_sequence_next, ncf_sequence_max
           FROM currency_settings WHERE workspace_id = ?`,
        )
        .get(input.workspaceId) as
        | { ncf_series_active: string | null; ncf_sequence_next: number | null; ncf_sequence_max: number | null }
        | undefined;
      if (!series || !series.ncf_series_active || series.ncf_sequence_next === null) {
        throw new Error(
          "No active NCF series configured. Set the NCF series in Workspace → Currency before issuing invoices.",
        );
      }
      if (series.ncf_sequence_max !== null && series.ncf_sequence_next > series.ncf_sequence_max) {
        throw new Error(
          `NCF series ${series.ncf_series_active} is exhausted (last available was ${series.ncf_sequence_max}). Configure a new series.`,
        );
      }
      const seriesActive = series.ncf_series_active;
      const sequence = series.ncf_sequence_next;
      const ncf = `${seriesActive}${sequence.toString().padStart(8, "0")}`;

      db.prepare(
        `UPDATE currency_settings
         SET ncf_sequence_next = ncf_sequence_next + 1,
             updated_at = ?
         WHERE workspace_id = ?`,
      ).run(now, input.workspaceId);

      db.prepare(
        `UPDATE invoices
         SET status = 'issued', ncf = ?, ncf_series = ?, ncf_sequence = ?,
             issued_at = ?, updated_by_user_id = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).run(ncf, seriesActive, sequence, now, defaultActorUserId, now, input.invoiceId, input.workspaceId);

      enqueueOutbox(
        db,
        input.workspaceId,
        "invoice",
        input.invoiceId,
        { kind: "invoice.issue", invoiceId: input.invoiceId, ncf },
        `invoice-issue-${input.commandId}`,
        now,
      );

      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: current.invoice_number,
        repeated: false,
        summary: `Issued ${current.invoice_number} with NCF ${ncf}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw error;
    }
  },

  cancelInvoice(input: CancelInvoiceCommand): InvoiceMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: "—",
        repeated: true,
        summary: "Invoice was already cancelled.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("invoice cancel", existing.error_message));
    }

    const current = db
      .prepare("SELECT invoice_number, status, paid_amount FROM invoices WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.invoiceId) as
      | { invoice_number: string; status: InvoiceStatus; paid_amount: number }
      | undefined;
    if (!current) throw new Error("Invoice not found.");
    if (current.status === "paid" || current.status === "partially_paid") {
      throw new Error("Invoices with recorded payments cannot be cancelled; void them instead.");
    }
    if (current.status === "cancelled" || current.status === "void") {
      throw new Error(`Invoice is already ${current.status}.`);
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(now, defaultActorUserId, now, input.invoiceId, input.workspaceId);

    enqueueOutbox(
      db,
      input.workspaceId,
      "invoice",
      input.invoiceId,
      { kind: "invoice.cancel", invoiceId: input.invoiceId, reason: input.reason ?? null },
      `invoice-cancel-${input.commandId}`,
      now,
    );

    receiptHelpers.insertReceipt.run(
      input.commandId,
      input.workspaceId,
      defaultActorUserId,
      input.actorType,
      input.sourceChannel,
      now,
      "success",
      null,
    );

    return {
      commandId: input.commandId,
      invoiceId: input.invoiceId,
      invoiceNumber: current.invoice_number,
      repeated: false,
      summary: `Cancelled ${current.invoice_number}.`,
    };
  },

  recordInvoicePayment(input: RecordInvoicePaymentCommand): InvoiceMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: "—",
        repeated: true,
        summary: "Payment was already recorded for this command.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("invoice payment", existing.error_message));
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }

    const current = db
      .prepare(
        `SELECT invoice_number, status, total_amount, paid_amount, currency, exchange_rate
         FROM invoices WHERE workspace_id = ? AND id = ?`,
      )
      .get(input.workspaceId, input.invoiceId) as
      | {
          invoice_number: string;
          status: InvoiceStatus;
          total_amount: number;
          paid_amount: number;
          currency: string;
          exchange_rate: number;
        }
      | undefined;
    if (!current) throw new Error("Invoice not found.");
    if (current.status !== "issued" && current.status !== "partially_paid") {
      throw new Error(`Payments are only allowed on issued or partially-paid invoices (current: ${current.status}).`);
    }

    const exchangeRate = input.exchangeRate ?? current.exchange_rate ?? 1;
    const baseCurrencyAmount = Math.round(input.amount * exchangeRate * 100) / 100;
    const nextPaid = Math.round((current.paid_amount + input.amount) * 100) / 100;
    const totalAmount = Math.round(current.total_amount * 100) / 100;
    const nextOutstanding = Math.max(0, Math.round((totalAmount - nextPaid) * 100) / 100);
    const isFullyPaid = nextPaid >= totalAmount - 0.005;
    const nextStatus: InvoiceStatus = isFullyPaid ? "paid" : "partially_paid";
    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      const paymentId = `payment-${input.commandId}`;
      db.prepare(
        `INSERT INTO invoice_payments (
           id, workspace_id, invoice_id, paid_at, amount, currency,
           exchange_rate, base_currency_amount, payment_method, reference, notes,
           recorded_by_user_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        paymentId,
        input.workspaceId,
        input.invoiceId,
        input.paidAt,
        input.amount,
        input.currency.toUpperCase(),
        exchangeRate,
        baseCurrencyAmount,
        input.paymentMethod?.trim() || null,
        input.reference?.trim() || null,
        input.notes?.trim() || null,
        defaultActorUserId,
        now,
      );

      db.prepare(
        `UPDATE invoices
         SET paid_amount = ?, outstanding_amount = ?, status = ?,
             fully_paid_at = CASE WHEN ? = 'paid' THEN ? ELSE fully_paid_at END,
             updated_by_user_id = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).run(
        nextPaid,
        nextOutstanding,
        nextStatus,
        nextStatus,
        now,
        defaultActorUserId,
        now,
        input.invoiceId,
        input.workspaceId,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "invoice_payment",
        paymentId,
        { kind: "invoice.payment", invoiceId: input.invoiceId, paymentId },
        `invoice-payment-${input.commandId}`,
        now,
      );

      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        invoiceId: input.invoiceId,
        invoiceNumber: current.invoice_number,
        repeated: false,
        summary: isFullyPaid
          ? `Invoice ${current.invoice_number} fully paid.`
          : `Payment of ${input.amount.toFixed(2)} ${input.currency.toUpperCase()} recorded against ${current.invoice_number}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw error;
    }
  },

  /**
   * Convenience helper for the "Generate invoice" button in the quote
   * editor. Reads the approved quote, builds a `CreateInvoiceCommand`
   * payload from its snapshot, and delegates to `createInvoice`. We do
   * NOT validate the quote status here — the caller is expected to
   * gate this on `quote.status === 'approved'`.
   */
  createInvoiceFromQuote(
    quote: QuoteDetail,
    options: {
      commandId: string;
      actorType: CreateInvoiceCommand["actorType"];
      sourceChannel: CreateInvoiceCommand["sourceChannel"];
      issueDate?: string;
      paymentTermsDays?: number;
    },
  ): InvoiceMutationResult {
    const activeInvoice = db
      .prepare(
        `
          SELECT id, invoice_number, status
          FROM invoices
          WHERE workspace_id = ?
            AND source_quote_id = ?
            AND status NOT IN ('cancelled', 'void')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(quote.workspaceId, quote.id) as
      | { id: string; invoice_number: string; status: InvoiceStatus }
      | undefined;

    if (activeInvoice) {
      throw new Error(
        `Quote ${quote.quoteNumber} already has active invoice ${activeInvoice.invoice_number} (${activeInvoice.status}). Open or cancel that invoice before generating a replacement.`,
      );
    }

    const issueDate = options.issueDate ?? new Date().toISOString().slice(0, 10);
    return this.createInvoice({
      commandId: options.commandId,
      workspaceId: quote.workspaceId,
      actorType: options.actorType,
      sourceChannel: options.sourceChannel,
      sourceQuoteId: quote.id,
      issueDate,
      paymentTermsDays: options.paymentTermsDays ?? 0,
      clientId: quote.clientId,
      clientNameSnapshot: quote.clientNameSnapshot,
      clientRncSnapshot: quote.clientRncSnapshot,
      productionCompanyId: quote.productionCompanyId,
      productionCompanyNameSnapshot: quote.productionCompanyNameSnapshot,
      productionPurSnapshot: quote.productionPurSnapshot,
      workspaceSirecineSnapshot: quote.workspaceSirecineSnapshot,
      attentionName: quote.attentionName,
      attentionPhone: quote.attentionPhone,
      projectId: quote.projectId,
      projectNameSnapshot: quote.projectNameSnapshot,
      productionName: quote.productionName,
      description: quote.description,
      packageTitle: quote.packageTitle,
      currency: quote.currency,
      baseCurrency: quote.baseCurrency,
      exchangeRate: quote.exchangeRate,
      exchangeRateSource: quote.exchangeRateSource,
      exchangeRateType: quote.exchangeRateType,
      exchangeRateEffectiveDate: quote.exchangeRateEffectiveDate,
      taxProfile: quote.taxProfile,
      itbisRate: quote.itbisRate,
      taxAddedToTotal: quote.taxAddedToTotal,
      taxNotes: quote.taxNotes,
      discountRate: quote.discountRate,
      discountAmount: quote.discountAmount,
      observations: quote.observations,
      items: quote.items.map((item) => ({
        sortOrder: item.sortOrder,
        quantity: item.quantity,
        title: item.title,
        description: item.description,
        durationValue: item.durationValue,
        durationUnit: item.durationUnit,
        unitPrice: item.unitPrice,
        discountRate: item.discountRate,
        discountAmount: item.discountAmount,
        taxBehavior: item.taxBehavior,
        taxRate: item.taxRate,
        notes: item.notes,
      })),
    });
  },
});

export type InvoiceMutationService = ReturnType<typeof createInvoiceMutationService>;
