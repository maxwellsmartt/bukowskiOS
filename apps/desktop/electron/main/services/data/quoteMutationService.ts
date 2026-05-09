import type { DatabaseSync } from "node:sqlite";

import type {
  CreateQuoteCommand,
  DuplicateQuoteCommand,
  QuoteItemInput,
  QuoteMutationResult,
  QuoteStatus,
  SetQuoteStatusCommand,
  UpdateQuoteCommand,
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
        id, workspace_id, entity_type, entity_id, event_id, operation_type,
        payload_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'upsert', ?, 'pending', ?, ?)
    `,
  ).run(syncId, workspaceId, entityType, entityId, JSON.stringify(payload), now, now);
};

const padSequence = (seq: number) => seq.toString().padStart(4, "0");

const computeValidUntil = (quoteDate: string, validityDays: number): string => {
  const base = new Date(`${quoteDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid quote date.");
  base.setUTCDate(base.getUTCDate() + validityDays);
  return base.toISOString().slice(0, 10);
};

const persistQuoteItems = (
  db: DatabaseSync,
  workspaceId: string,
  quoteId: string,
  items: QuoteItemInput[],
  breakdowns: ReturnType<typeof calculateQuote>["itemBreakdowns"],
  now: string,
) => {
  db.prepare("DELETE FROM quote_items WHERE quote_id = ?").run(quoteId);
  const insert = db.prepare(`
    INSERT INTO quote_items (
      id, workspace_id, quote_id, sort_order, quantity, title, description,
      duration_value, duration_unit, unit_price, line_subtotal,
      discount_rate, discount_amount, tax_behavior, tax_rate, tax_amount,
      line_total, notes, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  items.forEach((item, index) => {
    const breakdown = breakdowns[index]!;
    const itemId = `${quoteId}-item-${item.sortOrder.toString().padStart(3, "0")}-${index}`;
    insert.run(
      itemId,
      workspaceId,
      quoteId,
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

const insertVersionSnapshot = (
  db: DatabaseSync,
  workspaceId: string,
  quoteId: string,
  versionNumber: number,
  snapshot: unknown,
  changeSummary: string | null,
  now: string,
) => {
  db.prepare(
    `
      INSERT INTO quote_versions (
        id, workspace_id, quote_id, version_number, snapshot_json,
        change_summary, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `${quoteId}-v${versionNumber}`,
    workspaceId,
    quoteId,
    versionNumber,
    JSON.stringify(snapshot),
    changeSummary,
    defaultActorUserId,
    now,
  );
};

const buildQuoteSnapshot = (
  header: CreateQuoteCommand | UpdateQuoteCommand,
  totals: ReturnType<typeof calculateQuote>,
  quoteNumber: string,
  validUntil: string,
) => ({
  quoteNumber,
  status: "draft",
  quoteDate: header.quoteDate,
  validUntil,
  client: header.clientNameSnapshot,
  productionCompany: header.productionCompanyNameSnapshot ?? null,
  currency: header.currency,
  total: totals.total,
  baseCurrencyTotal: totals.baseCurrencyTotal,
  taxProfile: header.taxProfile,
  taxAddedToTotal: header.taxAddedToTotal,
  itemCount: header.items.length,
});

export const createQuoteMutationService = (db: DatabaseSync) => ({
  createQuote(input: CreateQuoteCommand): QuoteMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      const found = db
        .prepare("SELECT id, quote_number FROM quotes WHERE workspace_id = ? AND id = ?")
        .get(input.workspaceId, `quote-${input.commandId}`) as { id: string; quote_number: string } | undefined;
      return {
        commandId: input.commandId,
        quoteId: found?.id ?? `quote-${input.commandId}`,
        quoteNumber: found?.quote_number ?? "—",
        repeated: true,
        summary: "Quote was already created for this command.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("quote creation", existing.error_message));
    }

    if (input.items.length === 0) throw new Error("A quote needs at least one line item.");
    if (input.validityDays < 1) throw new Error("Validity must be at least 1 day.");

    const quoteId = `quote-${input.commandId}`;
    const validUntil = computeValidUntil(input.quoteDate, input.validityDays);
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
    const year = new Date(`${input.quoteDate}T00:00:00Z`).getUTCFullYear();

    db.exec("BEGIN IMMEDIATE");
    try {
      const seqRow = db
        .prepare(
          "SELECT COALESCE(MAX(quote_sequence), 0) AS max_seq FROM quotes WHERE workspace_id = ? AND quote_year = ?",
        )
        .get(input.workspaceId, year) as { max_seq: number };
      const nextSeq = (seqRow?.max_seq ?? 0) + 1;
      const quoteNumber = `${year}-${padSequence(nextSeq)}`;

      db.prepare(
        `
          INSERT INTO quotes (
            id, workspace_id, quote_number, quote_year, quote_sequence, status,
            quote_date, validity_days, valid_until,
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
            observations, created_by_user_id, updated_by_user_id,
            created_by_actor_type, source_channel,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, 'draft',
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
            ?, ?, ?, ?, ?, ?, ?
          )
        `,
      ).run(
        quoteId,
        input.workspaceId,
        quoteNumber,
        year,
        nextSeq,
        input.quoteDate,
        input.validityDays,
        validUntil,
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
        input.observations?.trim() || null,
        defaultActorUserId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        now,
      );

      persistQuoteItems(db, input.workspaceId, quoteId, input.items, totals.itemBreakdowns, now);

      insertVersionSnapshot(
        db,
        input.workspaceId,
        quoteId,
        1,
        buildQuoteSnapshot(input, totals, quoteNumber, validUntil),
        "Quote created.",
        now,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "quote",
        quoteId,
        {
          quoteNumber,
          status: "draft",
          currency: input.currency,
          total: totals.total,
        },
        `sync-${input.commandId}`,
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
        quoteId,
        quoteNumber,
        repeated: false,
        summary: `Quote ${quoteNumber} created (${input.currency.toUpperCase()} ${totals.total.toFixed(2)}).`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Quote create failed.",
      );
      throw error;
    }
  },

  updateQuote(input: UpdateQuoteCommand): QuoteMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        quoteId: input.quoteId,
        quoteNumber: "—",
        repeated: true,
        summary: "Quote update was already applied.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("quote update", existing.error_message));
    }

    if (input.items.length === 0) throw new Error("A quote needs at least one line item.");

    const current = db
      .prepare("SELECT id, quote_number, status FROM quotes WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.quoteId) as
      | { id: string; quote_number: string; status: QuoteStatus }
      | undefined;
    if (!current) throw new Error("Quote not found.");
    if (current.status !== "draft") {
      throw new Error(`Only draft quotes can be edited (current status: ${current.status}).`);
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
    const validUntil = computeValidUntil(input.quoteDate, input.validityDays);
    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          UPDATE quotes SET
            quote_date = ?, validity_days = ?, valid_until = ?,
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
            observations = ?, updated_by_user_id = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `,
      ).run(
        input.quoteDate,
        input.validityDays,
        validUntil,
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
        input.observations?.trim() || null,
        defaultActorUserId,
        now,
        input.quoteId,
        input.workspaceId,
      );

      persistQuoteItems(db, input.workspaceId, input.quoteId, input.items, totals.itemBreakdowns, now);

      const lastVersion = db
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) AS v FROM quote_versions WHERE quote_id = ?",
        )
        .get(input.quoteId) as { v: number };
      const nextVersion = (lastVersion?.v ?? 0) + 1;
      insertVersionSnapshot(
        db,
        input.workspaceId,
        input.quoteId,
        nextVersion,
        buildQuoteSnapshot(input, totals, current.quote_number, validUntil),
        input.changeSummary?.trim() || `Quote updated (v${nextVersion}).`,
        now,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "quote",
        input.quoteId,
        { updatedAt: now, total: totals.total, version: nextVersion },
        `sync-${input.commandId}`,
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
        quoteId: input.quoteId,
        quoteNumber: current.quote_number,
        repeated: false,
        summary: `Quote ${current.quote_number} updated.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Quote update failed.",
      );
      throw error;
    }
  },

  setStatus(input: SetQuoteStatusCommand): QuoteMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        quoteId: input.quoteId,
        quoteNumber: "—",
        repeated: true,
        summary: "Status change already applied.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("quote status change", existing.error_message));
    }

    const current = db
      .prepare("SELECT quote_number, status FROM quotes WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.quoteId) as { quote_number: string; status: QuoteStatus } | undefined;
    if (!current) throw new Error("Quote not found.");

    const transitions: Record<QuoteStatus, Array<SetQuoteStatusCommand["status"]>> = {
      draft: ["sent", "cancelled"],
      sent: ["approved", "rejected", "cancelled"],
      approved: ["cancelled"],
      rejected: ["cancelled"],
      expired: ["cancelled"],
      cancelled: [],
    };
    if (!transitions[current.status].includes(input.status)) {
      throw new Error(`Cannot transition from ${current.status} to ${input.status}.`);
    }
    if (current.status === "approved" && input.status === "cancelled" && !input.reason?.trim()) {
      throw new Error("Cancelling an approved quote requires a reason.");
    }

    const now = new Date().toISOString();
    const stampColumn = ({
      sent: "sent_at",
      approved: "approved_at",
      rejected: "rejected_at",
      cancelled: "cancelled_at",
    } as const)[input.status];

    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE quotes SET status = ?, ${stampColumn} = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
      ).run(input.status, now, now, input.quoteId, input.workspaceId);

      enqueueOutbox(
        db,
        input.workspaceId,
        "quote",
        input.quoteId,
        { status: input.status, reason: input.reason ?? null, updatedAt: now },
        `sync-${input.commandId}`,
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
        quoteId: input.quoteId,
        quoteNumber: current.quote_number,
        repeated: false,
        summary: `Quote ${current.quote_number} → ${input.status}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Status change failed.",
      );
      throw error;
    }
  },

  duplicateQuote(input: DuplicateQuoteCommand): QuoteMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        quoteId: `quote-${input.commandId}`,
        quoteNumber: "—",
        repeated: true,
        summary: "Quote duplication already applied.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("quote duplication", existing.error_message));
    }

    const sourceRow = db
      .prepare("SELECT * FROM quotes WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.quoteId) as Record<string, unknown> | undefined;
    if (!sourceRow) throw new Error("Quote not found.");

    const sourceItems = db
      .prepare("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC")
      .all(input.quoteId) as Array<Record<string, unknown>>;

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const year = new Date(`${today}T00:00:00Z`).getUTCFullYear();
    const quoteId = `quote-${input.commandId}`;

    db.exec("BEGIN IMMEDIATE");
    try {
      const seqRow = db
        .prepare(
          "SELECT COALESCE(MAX(quote_sequence), 0) AS max_seq FROM quotes WHERE workspace_id = ? AND quote_year = ?",
        )
        .get(input.workspaceId, year) as { max_seq: number };
      const nextSeq = (seqRow?.max_seq ?? 0) + 1;
      const quoteNumber = `${year}-${padSequence(nextSeq)}`;
      const validityDays = Number(sourceRow.validity_days ?? 30);
      const validUntil = computeValidUntil(today, validityDays);

      db.prepare(
        `
          INSERT INTO quotes (
            id, workspace_id, quote_number, quote_year, quote_sequence, status,
            quote_date, validity_days, valid_until,
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
            observations, created_by_user_id, updated_by_user_id,
            created_by_actor_type, source_channel,
            created_at, updated_at
          )
          SELECT
            ?, workspace_id, ?, ?, ?, 'draft',
            ?, validity_days, ?,
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
            observations, ?, ?, ?, ?, ?, ?
          FROM quotes WHERE id = ? AND workspace_id = ?
        `,
      ).run(
        quoteId,
        quoteNumber,
        year,
        nextSeq,
        today,
        validUntil,
        defaultActorUserId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        now,
        input.quoteId,
        input.workspaceId,
      );

      const insertItem = db.prepare(`
        INSERT INTO quote_items (
          id, workspace_id, quote_id, sort_order, quantity, title, description,
          duration_value, duration_unit, unit_price, line_subtotal,
          discount_rate, discount_amount, tax_behavior, tax_rate, tax_amount,
          line_total, notes, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      sourceItems.forEach((row, index) => {
        const r = row as Record<string, string | number | null>;
        insertItem.run(
          `${quoteId}-item-${index}`,
          input.workspaceId,
          quoteId,
          r.sort_order,
          r.quantity,
          r.title,
          r.description,
          r.duration_value,
          r.duration_unit,
          r.unit_price,
          r.line_subtotal,
          r.discount_rate,
          r.discount_amount,
          r.tax_behavior,
          r.tax_rate,
          r.tax_amount,
          r.line_total,
          r.notes,
          r.metadata_json,
          now,
          now,
        );
      });

      insertVersionSnapshot(
        db,
        input.workspaceId,
        quoteId,
        1,
        { duplicatedFrom: input.quoteId, sourceQuoteNumber: sourceRow.quote_number, quoteNumber },
        `Duplicated from ${sourceRow.quote_number as string}.`,
        now,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "quote",
        quoteId,
        { quoteNumber, status: "draft", duplicatedFrom: input.quoteId },
        `sync-${input.commandId}`,
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
        quoteId,
        quoteNumber,
        repeated: false,
        summary: `Quote ${quoteNumber} duplicated from ${sourceRow.quote_number as string}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Duplicate failed.",
      );
      throw error;
    }
  },

  deleteQuote(input: DuplicateQuoteCommand): QuoteMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        quoteId: input.quoteId,
        quoteNumber: "—",
        repeated: true,
        summary: "Quote was already deleted.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("quote delete", existing.error_message));
    }

    const current = db
      .prepare("SELECT id, quote_number, status FROM quotes WHERE workspace_id = ? AND id = ?")
      .get(input.workspaceId, input.quoteId) as
      | { id: string; quote_number: string; status: QuoteStatus }
      | undefined;
    if (!current) {
      throw new Error("Quote not found.");
    }
    if (current.status !== "draft" && current.status !== "cancelled" && current.status !== "rejected") {
      throw new Error(
        "Only draft, cancelled or rejected quotes can be deleted. Cancel the quote first if it's already been sent.",
      );
    }

    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      // Cascading FKs handle quote_items + quote_versions; defensive cleanup
      // for environments where the schema was created without ON DELETE CASCADE.
      db.prepare("DELETE FROM quote_items WHERE quote_id = ?").run(input.quoteId);
      db.prepare("DELETE FROM quote_versions WHERE quote_id = ?").run(input.quoteId);
      const result = db
        .prepare("DELETE FROM quotes WHERE workspace_id = ? AND id = ?")
        .run(input.workspaceId, input.quoteId);
      if (result.changes === 0) {
        throw new Error("Quote could not be deleted (already removed?).");
      }

      enqueueOutbox(
        db,
        input.workspaceId,
        "quote",
        input.quoteId,
        { deleted: true, quoteNumber: current.quote_number, deletedAt: now },
        `sync-${input.commandId}`,
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
        quoteId: input.quoteId,
        quoteNumber: current.quote_number,
        repeated: false,
        summary: `Quote ${current.quote_number} deleted.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Quote delete failed.",
      );
      throw error;
    }
  },

  expireOverdueQuotes(workspaceId: string, asOf?: string): { expiredCount: number } {
    const now = new Date().toISOString();
    const today = asOf ?? now.slice(0, 10);
    const result = db
      .prepare(
        `
          UPDATE quotes
          SET status = 'expired', expired_at = ?, updated_at = ?
          WHERE workspace_id = ?
            AND status IN ('draft', 'sent')
            AND valid_until < ?
        `,
      )
      .run(now, now, workspaceId, today);
    return { expiredCount: Number(result.changes ?? 0) };
  },
});

export type QuoteMutationService = ReturnType<typeof createQuoteMutationService>;
