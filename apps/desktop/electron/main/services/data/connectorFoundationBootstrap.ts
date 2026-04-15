import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
const now = "2026-04-14T19:00:00.000Z";

const connectorDefaults = [
  {
    id: "agent-connector-whatsapp",
    connectorKey: "whatsapp",
    displayName: "WhatsApp",
    status: "not_configured",
    capabilitySummary: "Inbound and outbound production messaging.",
    notes: "Future connector shell.",
  },
  {
    id: "agent-connector-telegram",
    connectorKey: "telegram",
    displayName: "Telegram",
    status: "disabled",
    capabilitySummary: "Fast operator messaging and alert routing.",
    notes: "DM-first operational connector.",
  },
  {
    id: "agent-connector-email",
    connectorKey: "email",
    displayName: "Email / Notifications",
    status: "configured",
    capabilitySummary: "Drafts, support outreach and internal notices.",
    notes: "Legacy notification surface.",
  },
  {
    id: "agent-connector-webhook",
    connectorKey: "webhook",
    displayName: "Webhook / Future",
    status: "not_configured",
    capabilitySummary: "Future integrations and gateway automations.",
    notes: "Future connector shell.",
  },
] as const;

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const hasTable = (db: DatabaseSync, tableName: string) => {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
};

const ensureColumn = (db: DatabaseSync, tableName: string, columnName: string, sqlType: string) => {
  if (!hasTable(db, tableName) || hasColumn(db, tableName, columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType};`);
};

export const applyConnectorFoundationMigration = (db: DatabaseSync) => {
  ensureColumn(db, "agent_connector_configs", "bot_username", "TEXT");
  ensureColumn(db, "agent_connector_configs", "last_tested_at", "TEXT");
  ensureColumn(db, "agent_connector_configs", "last_error_summary", "TEXT");

  ensureColumn(db, "assistant_chat_messages", "source_connector_key", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "source_channel_id", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "source_external_message_id", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "source_actor_user_id", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "correlation_id", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "source_metadata_json", "TEXT");

  ensureColumn(db, "agent_runs", "source_connector_key", "TEXT");
  ensureColumn(db, "agent_runs", "source_channel_id", "TEXT");
  ensureColumn(db, "agent_runs", "source_external_message_id", "TEXT");
  ensureColumn(db, "agent_runs", "source_actor_user_id", "TEXT");
  ensureColumn(db, "agent_runs", "correlation_id", "TEXT");
};

export const bootstrapConnectorFoundation = (db: DatabaseSync) => {
  applyConnectorFoundationMigration(db);

  const workspaceRows = db.prepare("SELECT id FROM workspaces").all() as Array<{ id: string }>;

  if (!workspaceRows.length) {
    return;
  }

  const insertConnector = db.prepare(`
    INSERT OR IGNORE INTO agent_connector_configs (
      id,
      workspace_id,
      connector_key,
      display_name,
      status,
      capability_summary,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  workspaceRows.forEach((workspace) => {
    connectorDefaults.forEach((connector) => {
      insertConnector.run(
        workspace.id === workspaceId ? connector.id : `${connector.id}-${workspace.id}`,
        workspace.id,
        connector.connectorKey,
        connector.displayName,
        connector.status,
        connector.capabilitySummary,
        connector.notes,
        now,
        now,
      );
    });
  });
};
