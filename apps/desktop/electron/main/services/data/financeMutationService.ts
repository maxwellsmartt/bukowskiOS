import type { DatabaseSync } from "node:sqlite";

import type {
  CreateFinancialEntryCommand,
  FinanceEntryMutationResult,
  UpdateFinancialEntryCommand,
} from "@contracts";

const defaultActorUserId = "user-ops";

const uniqueValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const createPlaceholders = (values: string[]) => values.map(() => "?").join(", ");

const loadEntityMap = (db: DatabaseSync, tableName: "projects" | "assets" | "incidents" | "users", values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const labelExpression =
    tableName === "incidents"
      ? "title"
      : tableName === "users"
        ? "full_name"
        : tableName === "assets"
          ? "name"
          : "name";

  const rows = db
    .prepare(
      `
        SELECT id, ${labelExpression} AS label
        FROM ${tableName}
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as Array<{ id: string; label: string }>;

  return new Map(rows.map((row) => [row.id, row.label]));
};

const ensureEntityExists = (value: string | undefined | null, label: string, map: Map<string, string>) => {
  if (!value) {
    return;
  }

  if (!map.has(value)) {
    throw new Error(`${label} not found.`);
  }
};

const normalizeOptionalText = (value?: string | null) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const nextValue = value.trim();
  return nextValue ? nextValue : null;
};

const buildFailedCommandMessage = (label: string, previousError?: string | null) =>
  previousError
    ? `This command id already failed once for ${label}: ${previousError}`
    : `This command id already failed once for ${label}. Generate a new action and retry.`;

const createCommandReceiptHelpers = (db: DatabaseSync) => ({
  getExistingReceipt(commandId: string) {
    return db
      .prepare(
        `
          SELECT outcome_status, error_message
          FROM command_receipts
          WHERE command_id = ?
          LIMIT 1
        `,
      )
      .get(commandId) as { outcome_status: string; error_message: string | null } | undefined;
  },
  insertReceipt: db.prepare(
    `
      INSERT OR REPLACE INTO command_receipts (
        command_id,
        workspace_id,
        actor_user_id,
        actor_type,
        source_channel,
        executed_at,
        outcome_status,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ),
});

const loadWorkspaceBaseCurrency = (db: DatabaseSync, workspaceId: string) =>
  (db.prepare("SELECT base_currency FROM workspaces WHERE id = ? LIMIT 1").get(workspaceId) as { base_currency: string } | undefined)
    ?.base_currency ?? "USD";

const loadFinanceEntryRecord = (db: DatabaseSync, workspaceId: string, entryId: string) =>
  db
    .prepare(
      `
        SELECT
          id,
          entry_type,
          category,
          amount,
          currency,
          exchange_rate,
          base_currency_amount,
          status,
          project_id,
          asset_id,
          incident_id,
          entry_date,
          description,
          notes
        FROM financial_entries
        WHERE workspace_id = ?
          AND id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, entryId) as
    | {
        id: string;
        entry_type: string;
        category: string;
        amount: number;
        currency: string;
        exchange_rate: number | null;
        base_currency_amount: number | null;
        status: string;
        project_id: string | null;
        asset_id: string | null;
        incident_id: string | null;
        entry_date: string;
        description: string | null;
        notes: string | null;
      }
    | undefined;

const deriveLinkedContext = (
  db: DatabaseSync,
  incidentId: string | null | undefined,
  current: { projectId?: string | null; assetId?: string | null },
) => {
  if (!incidentId) {
    return {
      projectId: current.projectId ?? null,
      assetId: current.assetId ?? null,
    };
  }

  const incident = db
    .prepare(
      `
        SELECT project_id, asset_id
        FROM incidents
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(incidentId) as { project_id: string | null; asset_id: string | null } | undefined;

  if (!incident) {
    throw new Error("Incident not found.");
  }

  return {
    projectId: current.projectId ?? incident.project_id ?? null,
    assetId: current.assetId ?? incident.asset_id ?? null,
  };
};

const buildSummary = (action: "created" | "updated", entryType: string, amount: number) =>
  action === "created"
    ? `${entryType} entry created for $${amount.toLocaleString()}.`
    : `${entryType} entry updated to $${amount.toLocaleString()}.`;

export const createFinanceMutationService = (db: DatabaseSync) => ({
  createEntry(input: CreateFinancialEntryCommand): FinanceEntryMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existingReceipt = receiptHelpers.getExistingReceipt(input.commandId);

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        entryId: `finance-${input.commandId}`,
        repeated: true,
        summary: "This finance entry command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("finance entry creation", existingReceipt.error_message));
    }

    const linkedContext = deriveLinkedContext(db, input.incidentId, {
      projectId: input.projectId,
      assetId: input.assetId,
    });

    const projectId = linkedContext.projectId;
    const assetId = linkedContext.assetId;
    const incidentId = input.incidentId ?? null;
    const workspaceCurrency = loadWorkspaceBaseCurrency(db, input.workspaceId);
    const currency = input.currency?.trim() || workspaceCurrency;
    const exchangeRate = input.exchangeRate ?? (currency === workspaceCurrency ? 1 : null);
    const baseCurrencyAmount =
      input.baseCurrencyAmount ?? (exchangeRate !== null ? Number((input.amount * exchangeRate).toFixed(2)) : null);
    const description = normalizeOptionalText(input.description);
    const notes = normalizeOptionalText(input.notes);
    const now = new Date().toISOString();
    const entryId = `finance-${input.commandId}`;

    const projectMap = loadEntityMap(db, "projects", uniqueValues([projectId]));
    const assetMap = loadEntityMap(db, "assets", uniqueValues([assetId]));
    const incidentMap = loadEntityMap(db, "incidents", uniqueValues([incidentId]));
    const userMap = loadEntityMap(db, "users", uniqueValues([defaultActorUserId]));

    ensureEntityExists(projectId, "Project", projectMap);
    ensureEntityExists(assetId, "Asset", assetMap);
    ensureEntityExists(incidentId, "Incident", incidentMap);
    ensureEntityExists(defaultActorUserId, "Actor user", userMap);

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO financial_entries (
            id,
            workspace_id,
            entry_type,
            category,
            amount,
            currency,
            exchange_rate,
            base_currency_amount,
            status,
            project_id,
            asset_id,
            incident_id,
            created_by_user_id,
            entry_date,
            description,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        entryId,
        input.workspaceId,
        input.entryType.trim(),
        input.category.trim(),
        input.amount,
        currency,
        exchangeRate,
        baseCurrencyAmount,
        input.status.trim(),
        projectId,
        assetId,
        incidentId,
        defaultActorUserId,
        input.entryDate.trim(),
        description ?? null,
        notes ?? null,
        now,
        now,
      );

      db.prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, 'financial_entry', ?, NULL, 'upsert', ?, 'pending', ?, ?)
        `,
      ).run(
        `sync-${input.commandId}`,
        input.workspaceId,
        entryId,
        JSON.stringify({
          entryId,
          entryType: input.entryType.trim(),
          category: input.category.trim(),
          amount: input.amount,
          currency,
          status: input.status.trim(),
          projectId,
          assetId,
          incidentId,
        }),
        now,
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
        error instanceof Error ? error.message : "Finance entry creation failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      entryId,
      repeated: false,
      summary: buildSummary("created", input.entryType.trim(), input.amount),
    };
  },

  updateEntry(input: UpdateFinancialEntryCommand): FinanceEntryMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existingReceipt = receiptHelpers.getExistingReceipt(input.commandId);

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        entryId: input.entryId,
        repeated: true,
        summary: "This finance entry update was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("finance entry update", existingReceipt.error_message));
    }

    const currentEntry = loadFinanceEntryRecord(db, input.workspaceId, input.entryId);

    if (!currentEntry) {
      throw new Error("Finance entry not found.");
    }

    const linkedContext = deriveLinkedContext(db, input.incidentId, {
      projectId: input.projectId,
      assetId: input.assetId,
    });

    const projectId = linkedContext.projectId;
    const assetId = linkedContext.assetId;
    const incidentId = input.incidentId ?? null;
    const workspaceCurrency = loadWorkspaceBaseCurrency(db, input.workspaceId);
    const currency = input.currency?.trim() || workspaceCurrency;
    const exchangeRate = input.exchangeRate ?? (currency === workspaceCurrency ? 1 : null);
    const baseCurrencyAmount =
      input.baseCurrencyAmount ?? (exchangeRate !== null ? Number((input.amount * exchangeRate).toFixed(2)) : null);
    const description = normalizeOptionalText(input.description);
    const notes = normalizeOptionalText(input.notes);
    const now = new Date().toISOString();

    const projectMap = loadEntityMap(db, "projects", uniqueValues([projectId]));
    const assetMap = loadEntityMap(db, "assets", uniqueValues([assetId]));
    const incidentMap = loadEntityMap(db, "incidents", uniqueValues([incidentId]));
    const userMap = loadEntityMap(db, "users", uniqueValues([defaultActorUserId]));

    ensureEntityExists(projectId, "Project", projectMap);
    ensureEntityExists(assetId, "Asset", assetMap);
    ensureEntityExists(incidentId, "Incident", incidentMap);
    ensureEntityExists(defaultActorUserId, "Actor user", userMap);

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE financial_entries
          SET
            entry_type = ?,
            category = ?,
            amount = ?,
            currency = ?,
            exchange_rate = ?,
            base_currency_amount = ?,
            status = ?,
            project_id = ?,
            asset_id = ?,
            incident_id = ?,
            entry_date = ?,
            description = ?,
            notes = ?,
            updated_at = ?
          WHERE id = ?
            AND workspace_id = ?
        `,
      ).run(
        input.entryType.trim(),
        input.category.trim(),
        input.amount,
        currency,
        exchangeRate,
        baseCurrencyAmount,
        input.status.trim(),
        projectId,
        assetId,
        incidentId,
        input.entryDate.trim(),
        description ?? null,
        notes ?? null,
        now,
        input.entryId,
        input.workspaceId,
      );

      db.prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, 'financial_entry', ?, NULL, 'upsert', ?, 'pending', ?, ?)
        `,
      ).run(
        `sync-${input.commandId}`,
        input.workspaceId,
        input.entryId,
        JSON.stringify({
          entryId: input.entryId,
          previous: {
            entryType: currentEntry.entry_type,
            amount: currentEntry.amount,
            status: currentEntry.status,
          },
          next: {
            entryType: input.entryType.trim(),
            category: input.category.trim(),
            amount: input.amount,
            currency,
            status: input.status.trim(),
            projectId,
            assetId,
            incidentId,
          },
        }),
        now,
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
        error instanceof Error ? error.message : "Finance entry update failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      entryId: input.entryId,
      repeated: false,
      summary: buildSummary("updated", input.entryType.trim(), input.amount),
    };
  },
});
