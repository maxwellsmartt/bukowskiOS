import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

type DataRetentionDeps = {
  fileSystem?: Pick<typeof fs, "existsSync" | "unlinkSync">;
  now?: () => string;
};

export type DataRetentionSummary = {
  archivedMemoryEntries: number;
  deletedSentOutboxRows: number;
  deletedRuntimeErrorRows: number;
  deletedAgentActivityRows: number;
  deletedChatThreads: number;
  deletedAttachmentFiles: number;
  deletedMemoryEvents: number;
  vacuumed: boolean;
};

type DataRetentionArgs = {
  chatSoftDeleteDays?: number;
  sentOutboxDays?: number;
  runtimeErrorDays?: number;
  runtimeErrorMaxRows?: number;
  agentActivityDays?: number;
  agentActivityMaxRows?: number;
  memoryLowConfidenceDays?: number;
  memoryMinConfidence?: number;
  memoryEventsDays?: number;
};

// Once a single pass removes more than this many rows, reclaim the freed pages
// with VACUUM — deletes alone leave the file size untouched in SQLite.
const VACUUM_THRESHOLD_ROWS = 50_000;

const subtractDays = (value: string, days: number) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

export const summarizeDataRetention = (summary: DataRetentionSummary) => {
  const parts = [
    summary.archivedMemoryEntries ? `${summary.archivedMemoryEntries} memory entries archived` : null,
    summary.deletedSentOutboxRows ? `${summary.deletedSentOutboxRows} sent sync rows removed` : null,
    summary.deletedChatThreads ? `${summary.deletedChatThreads} deleted threads purged` : null,
    summary.deletedAttachmentFiles ? `${summary.deletedAttachmentFiles} attachment files cleaned` : null,
    summary.deletedRuntimeErrorRows ? `${summary.deletedRuntimeErrorRows} runtime errors trimmed` : null,
    summary.deletedAgentActivityRows ? `${summary.deletedAgentActivityRows} activity events trimmed` : null,
    summary.deletedMemoryEvents ? `${summary.deletedMemoryEvents} memory events trimmed` : null,
    summary.vacuumed ? "database compacted" : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(" · ") : "Nothing to purge in this pass.";
};

export const createDataRetentionService = (db: DatabaseSync, deps: DataRetentionDeps = {}) => {
  const fileSystem = deps.fileSystem ?? fs;

  return {
    run(args?: DataRetentionArgs): DataRetentionSummary {
      const now = deps.now?.() ?? new Date().toISOString();
      const chatCutoff = subtractDays(now, Math.max(30, args?.chatSoftDeleteDays ?? 90));
      const sentOutboxCutoff = subtractDays(now, Math.max(7, args?.sentOutboxDays ?? 30));
      const runtimeErrorCutoff = subtractDays(now, Math.max(14, args?.runtimeErrorDays ?? 90));
      const runtimeErrorMaxRows = Math.max(1000, args?.runtimeErrorMaxRows ?? 5000);
      const agentActivityCutoff = subtractDays(now, Math.max(14, args?.agentActivityDays ?? 90));
      const agentActivityMaxRows = Math.max(2000, args?.agentActivityMaxRows ?? 20000);
      const memoryCutoff = subtractDays(now, Math.max(7, args?.memoryLowConfidenceDays ?? 30));
      const memoryEventCutoff = subtractDays(now, Math.max(14, args?.memoryEventsDays ?? 120));
      const memoryMinConfidence = args?.memoryMinConfidence ?? 0.5;

      const oldDeletedAttachments = db
        .prepare(
          `
            SELECT assistant_chat_attachments.storage_path
            FROM assistant_chat_attachments
            JOIN assistant_chat_threads ON assistant_chat_threads.id = assistant_chat_attachments.thread_id
            WHERE assistant_chat_threads.workspace_id = ?
              AND assistant_chat_threads.deleted_at IS NOT NULL
              AND assistant_chat_threads.deleted_at < ?
          `,
        )
        .all(DEFAULT_WORKSPACE_ID, chatCutoff) as Array<{ storage_path: string }>;

      let deletedAttachmentFiles = 0;
      oldDeletedAttachments.forEach((attachment) => {
        try {
          if (fileSystem.existsSync(attachment.storage_path)) {
            fileSystem.unlinkSync(attachment.storage_path);
            deletedAttachmentFiles += 1;
          }
        } catch {
          // Best effort cleanup. DB purge should still continue.
        }
      });

      const archivedMemoryEntries = Number(
        db
        .prepare(
          `
            UPDATE assistant_memory_entries
            SET status = 'archived',
                updated_at = ?
            WHERE workspace_id = ?
              AND status = 'active'
              AND confidence < ?
              AND updated_at < ?
          `,
        )
        .run(now, DEFAULT_WORKSPACE_ID, memoryMinConfidence, memoryCutoff).changes,
      );

      const deletedSentOutboxRows = Number(
        db
        .prepare(
          `
            DELETE FROM sync_outbox
            WHERE workspace_id = ?
              AND status = 'sent'
              AND updated_at < ?
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, sentOutboxCutoff).changes,
      );

      const deletedRuntimeErrorByAge = Number(
        db
        .prepare(
          `
            DELETE FROM runtime_error_events
            WHERE workspace_id = ?
              AND created_at < ?
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, runtimeErrorCutoff).changes,
      );

      // Hard cap: even within the retention window a runaway error burst can
      // bloat the file, so keep only the newest N rows per workspace.
      const deletedRuntimeErrorByCap = Number(
        db
        .prepare(
          `
            DELETE FROM runtime_error_events
            WHERE workspace_id = ?
              AND id NOT IN (
                SELECT id FROM runtime_error_events
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                LIMIT ?
              )
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID, runtimeErrorMaxRows).changes,
      );
      const deletedRuntimeErrorRows = deletedRuntimeErrorByAge + deletedRuntimeErrorByCap;

      const deletedAgentActivityByAge = Number(
        db
        .prepare(
          `
            DELETE FROM agent_activity_events
            WHERE workspace_id = ?
              AND created_at < ?
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, agentActivityCutoff).changes,
      );

      const deletedAgentActivityByCap = Number(
        db
        .prepare(
          `
            DELETE FROM agent_activity_events
            WHERE workspace_id = ?
              AND id NOT IN (
                SELECT id FROM agent_activity_events
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                LIMIT ?
              )
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID, agentActivityMaxRows).changes,
      );
      const deletedAgentActivityRows = deletedAgentActivityByAge + deletedAgentActivityByCap;

      const deletedMemoryEvents = Number(
        db
        .prepare(
          `
            DELETE FROM assistant_memory_events
            WHERE workspace_id = ?
              AND created_at < ?
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, memoryEventCutoff).changes,
      );

      const deletedChatThreads = Number(
        db
        .prepare(
          `
            DELETE FROM assistant_chat_threads
            WHERE workspace_id = ?
              AND deleted_at IS NOT NULL
              AND deleted_at < ?
          `,
        )
        .run(DEFAULT_WORKSPACE_ID, chatCutoff).changes,
      );

      const totalDeleted =
        deletedSentOutboxRows +
        deletedRuntimeErrorRows +
        deletedAgentActivityRows +
        deletedMemoryEvents +
        deletedChatThreads;
      let vacuumed = false;
      if (totalDeleted >= VACUUM_THRESHOLD_ROWS) {
        try {
          db.exec("VACUUM;");
          vacuumed = true;
        } catch {
          // VACUUM is best-effort space reclamation; never fail the pass on it.
        }
      }

      return {
        archivedMemoryEntries,
        deletedSentOutboxRows,
        deletedRuntimeErrorRows,
        deletedAgentActivityRows,
        deletedChatThreads,
        deletedAttachmentFiles,
        deletedMemoryEvents,
        vacuumed,
      };
    },
  };
};

export type DataRetentionService = ReturnType<typeof createDataRetentionService>;
