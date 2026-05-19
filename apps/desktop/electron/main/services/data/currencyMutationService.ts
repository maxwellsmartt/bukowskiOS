import type { DatabaseSync } from "node:sqlite";

import type {
  CreateExchangeRateCommand,
  CurrencySettingsMutationResult,
  DeleteExchangeRateCommand,
  ExchangeRateMutationResult,
  UpsertCurrencySettingsCommand,
} from "@contracts";

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

export const createCurrencyMutationService = (db: DatabaseSync) => ({
  upsertSettings(input: UpsertCurrencySettingsCommand): CurrencySettingsMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);

    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        workspaceId: input.workspaceId,
        repeated: true,
        summary: "Currency settings already saved.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("currency settings", existing.error_message));
    }

    if (input.defaultItbisRate < 0 || input.defaultItbisRate > 1) {
      throw new Error("ITBIS rate must be between 0 and 1.");
    }
    if (input.defaultQuoteValidityDays < 1) {
      throw new Error("Quote validity must be at least 1 day.");
    }
    if (input.enabledCurrencies.length === 0) {
      throw new Error("At least one currency must be enabled.");
    }
    if (
      input.ncfSequenceNext !== null &&
      input.ncfSequenceNext !== undefined &&
      input.ncfSequenceMax !== null &&
      input.ncfSequenceMax !== undefined &&
      input.ncfSequenceNext > input.ncfSequenceMax
    ) {
      throw new Error("The next NCF sequence cannot be greater than the maximum sequence.");
    }

    const now = new Date().toISOString();
    const settingsId = `currency-settings-${input.workspaceId}`;

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          INSERT INTO currency_settings (
            id, workspace_id, base_currency, default_quote_currency,
            enabled_currencies_json, default_rate_source, default_rate_type,
            default_itbis_rate, default_quote_validity_days, sirecine_number,
            workspace_logo_url, workspace_seal_url, workspace_signature_url,
            ncf_series_active, ncf_sequence_next, ncf_sequence_max, ncf_expires_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            base_currency = excluded.base_currency,
            default_quote_currency = excluded.default_quote_currency,
            enabled_currencies_json = excluded.enabled_currencies_json,
            default_rate_source = excluded.default_rate_source,
            default_rate_type = excluded.default_rate_type,
            default_itbis_rate = excluded.default_itbis_rate,
            default_quote_validity_days = excluded.default_quote_validity_days,
            sirecine_number = excluded.sirecine_number,
            workspace_logo_url = excluded.workspace_logo_url,
            workspace_seal_url = excluded.workspace_seal_url,
            workspace_signature_url = excluded.workspace_signature_url,
            ncf_series_active = excluded.ncf_series_active,
            ncf_sequence_next = excluded.ncf_sequence_next,
            ncf_sequence_max = excluded.ncf_sequence_max,
            ncf_expires_at = excluded.ncf_expires_at,
            updated_at = excluded.updated_at
        `,
      ).run(
        settingsId,
        input.workspaceId,
        input.baseCurrency.trim().toUpperCase(),
        input.defaultQuoteCurrency.trim().toUpperCase(),
        JSON.stringify(input.enabledCurrencies.map((code) => code.trim().toUpperCase())),
        input.defaultRateSource,
        input.defaultRateType,
        input.defaultItbisRate,
        input.defaultQuoteValidityDays,
        input.sirecineNumber?.trim() || null,
        input.workspaceLogoUrl?.trim() || null,
        input.workspaceSealUrl?.trim() || null,
        input.workspaceSignatureUrl?.trim() || null,
        input.ncfSeriesActive?.trim() || null,
        input.ncfSequenceNext ?? null,
        input.ncfSequenceMax ?? null,
        input.ncfExpiresAt?.trim() || null,
        now,
        now,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "currency_settings",
        settingsId,
        {
          baseCurrency: input.baseCurrency,
          defaultQuoteCurrency: input.defaultQuoteCurrency,
          enabledCurrencies: input.enabledCurrencies,
          defaultRateSource: input.defaultRateSource,
          defaultRateType: input.defaultRateType,
          defaultItbisRate: input.defaultItbisRate,
          defaultQuoteValidityDays: input.defaultQuoteValidityDays,
          sirecineNumber: input.sirecineNumber ?? null,
          workspaceLogoUrl: input.workspaceLogoUrl ?? null,
          workspaceSealUrl: input.workspaceSealUrl ?? null,
          workspaceSignatureUrl: input.workspaceSignatureUrl ?? null,
          ncfSeriesActive: input.ncfSeriesActive ?? null,
          ncfSequenceNext: input.ncfSequenceNext ?? null,
          ncfSequenceMax: input.ncfSequenceMax ?? null,
          ncfExpiresAt: input.ncfExpiresAt ?? null,
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
        error instanceof Error ? error.message : "Currency settings save failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      workspaceId: input.workspaceId,
      repeated: false,
      summary: `Currency settings saved (base ${input.baseCurrency.toUpperCase()}, ITBIS ${(
        input.defaultItbisRate * 100
      ).toFixed(0)}%).`,
    };
  },

  createRate(input: CreateExchangeRateCommand): ExchangeRateMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);

    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        rateId: `rate-${input.commandId}`,
        repeated: true,
        summary: "Exchange rate already saved.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("exchange rate", existing.error_message));
    }

    if (input.rate <= 0) {
      throw new Error("Rate must be greater than zero.");
    }
    const baseCcy = input.baseCurrency.trim().toUpperCase();
    const quoteCcy = input.quoteCurrency.trim().toUpperCase();
    if (baseCcy === quoteCcy) {
      throw new Error("Base and quote currencies must differ.");
    }

    const now = new Date().toISOString();
    const rateId = `rate-${input.commandId}`;

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          INSERT INTO exchange_rates (
            id, workspace_id, base_currency, quote_currency, rate, rate_type,
            source, source_label, effective_date, fetched_at, created_by_user_id,
            notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        rateId,
        input.workspaceId,
        baseCcy,
        quoteCcy,
        input.rate,
        input.rateType,
        input.source,
        input.sourceLabel?.trim() || null,
        input.effectiveDate.trim(),
        input.fetchedAt ?? null,
        defaultActorUserId,
        input.notes?.trim() || null,
        now,
      );

      enqueueOutbox(
        db,
        input.workspaceId,
        "exchange_rate",
        rateId,
        {
          baseCurrency: baseCcy,
          quoteCurrency: quoteCcy,
          rate: input.rate,
          rateType: input.rateType,
          source: input.source,
          effectiveDate: input.effectiveDate,
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
        error instanceof Error ? error.message : "Rate save failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      rateId,
      repeated: false,
      summary: `Rate ${baseCcy}→${quoteCcy} = ${input.rate} (${input.rateType}, ${input.source}) saved.`,
    };
  },

  deleteRate(input: DeleteExchangeRateCommand): ExchangeRateMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);

    if (existing?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        rateId: input.rateId,
        repeated: true,
        summary: "Rate delete already applied.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("exchange rate delete", existing.error_message));
    }

    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      const result = db
        .prepare("DELETE FROM exchange_rates WHERE workspace_id = ? AND id = ?")
        .run(input.workspaceId, input.rateId);
      if (result.changes === 0) {
        throw new Error("Exchange rate not found.");
      }

      enqueueOutbox(
        db,
        input.workspaceId,
        "exchange_rate",
        input.rateId,
        { deleted: true },
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
        error instanceof Error ? error.message : "Rate delete failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      rateId: input.rateId,
      repeated: false,
      summary: "Exchange rate removed.",
    };
  },
});

export type CurrencyMutationService = ReturnType<typeof createCurrencyMutationService>;
