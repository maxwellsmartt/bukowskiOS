import type { DatabaseSync } from "node:sqlite";

import { isLocalTimestampAtLeastAsNew } from "./syncTimestampPolicy";

import { getDesktopLogger } from "../logger";

export type AutomationControlPlaneEntityType = "agents" | "ai_provider_configs" | "agent_connector_configs";

export type RemoteAutomationControlPlaneRow = Record<string, unknown> & {
  id: string;
  workspace_id: string;
  updated_at: string;
};

export type AutomationControlPlanePullResult = {
  entityType: AutomationControlPlaneEntityType;
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const logger = getDesktopLogger("automation-control-plane-pull");

const entityOutboxTypes: Record<AutomationControlPlaneEntityType, string> = {
  agents: "agent",
  ai_provider_configs: "ai_provider_config",
  agent_connector_configs: "agent_connector_config",
};

type SqlInputValue = string | number | bigint | Uint8Array | null;

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toSqlInputValue = (value: unknown): SqlInputValue => {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return JSON.stringify(value);
};

const hasOutboxPendingForEntity = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: AutomationControlPlaneEntityType,
  entityId: string,
): boolean => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = ?
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, entityOutboxTypes[entityType], entityId) as { count: number };
  return row.count > 0;
};

const readLocalUpdatedAt = (
  db: DatabaseSync,
  entityType: AutomationControlPlaneEntityType,
  entityId: string,
): string | null => {
  const row = db
    .prepare(`SELECT updated_at AS ts FROM ${entityType} WHERE id = ?`)
    .get(entityId) as { ts?: string | null } | undefined;
  return isoOrNull(row?.ts);
};

const loadTableColumns = (db: DatabaseSync, tableName: string) =>
  new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) => row.name),
  );

const upsertRow = (
  db: DatabaseSync,
  entityType: AutomationControlPlaneEntityType,
  row: RemoteAutomationControlPlaneRow,
) => {
  const tableColumns = loadTableColumns(db, entityType);
  const entries = Object.entries(row).filter(([key]) => tableColumns.has(key));

  if (!entries.some(([key]) => key === "id")) {
    throw new Error(`Remote ${entityType} row is missing id.`);
  }

  const columns = entries.map(([key]) => key);
  const values = entries.map(([, value]) => toSqlInputValue(value));
  const updateColumns = columns.filter((column) => column !== "id" && column !== "created_at");

  db.prepare(
    `
      INSERT INTO ${entityType} (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET
        ${updateColumns.map((column) => `${column} = excluded.${column}`).join(", ")}
    `,
  ).run(...values);
};

const updateCursor = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: AutomationControlPlaneEntityType,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db.prepare(
    `
      INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        last_pulled_count = excluded.last_pulled_count,
        last_error = excluded.last_error,
        updated_at = CURRENT_TIMESTAMP
    `,
  ).run(workspaceId, entityType, cursorAfter, appliedCount, errorMessage);
};

export const createAutomationControlPlanePullService = (db: DatabaseSync) => {
  const readCursor = (workspaceId: string, entityType: AutomationControlPlaneEntityType): string | null => {
    const row = db
      .prepare(`SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = ?`)
      .get(workspaceId, entityType) as { last_synced_at?: string | null } | undefined;
    return isoOrNull(row?.last_synced_at);
  };

  return {
    applyRemoteRows(
      workspaceId: string,
      entityType: AutomationControlPlaneEntityType,
      rows: RemoteAutomationControlPlaneRow[],
    ): AutomationControlPlanePullResult {
      const result: AutomationControlPlanePullResult = {
        entityType,
        workspaceId,
        appliedCount: 0,
        skippedDueToOutboxCount: 0,
        skippedDueToOlderCount: 0,
        errors: [],
        cursorAfter: readCursor(workspaceId, entityType),
      };

      if (!rows.length) {
        return result;
      }

      db.exec("BEGIN");
      try {
        for (const row of rows) {
          if (row.workspace_id !== workspaceId) {
            continue;
          }

          if (hasOutboxPendingForEntity(db, workspaceId, entityType, row.id)) {
            result.skippedDueToOutboxCount += 1;
            continue;
          }

          const localUpdatedAt = readLocalUpdatedAt(db, entityType, row.id);
          if (localUpdatedAt && isLocalTimestampAtLeastAsNew(localUpdatedAt, row.updated_at)) {
            result.skippedDueToOlderCount += 1;
            continue;
          }

          try {
            upsertRow(db, entityType, row);
            result.appliedCount += 1;
            if (!result.cursorAfter || row.updated_at > result.cursorAfter) {
              result.cursorAfter = row.updated_at;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error applying automation control row.";
            result.errors.push(`${row.id}: ${message}`);
            logger.warn("Automation control plane pull row failed.", { entityType, id: row.id, error: message });
          }
        }

        updateCursor(db, workspaceId, entityType, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        const message = error instanceof Error ? error.message : "Unknown error during automation control plane pull.";
        result.errors.push(message);
        logger.error("Automation control plane pull transaction rolled back.", { entityType, error: message });
      }

      return result;
    },
  };
};

export type AutomationControlPlanePullService = ReturnType<typeof createAutomationControlPlanePullService>;
