import type { DatabaseSync } from "node:sqlite";
import type { AppSyncOutboxRow } from "@contracts";

import { getDesktopLogger, redactSensitiveText } from "../logger";

type SyncOutboxStatus = "pending" | "processing" | "failed" | "sent";

export type SyncOutboxRow = {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  event_id: string | null;
  operation_type: string;
  payload_json: string;
  status: SyncOutboxStatus;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncOutboxTransport = (row: SyncOutboxRow) => Promise<void> | void;

export type SyncOutboxWorkerSummary = {
  recoveredStaleRows: number;
  processedRows: number;
  sentRows: number;
  failedRows: number;
  skippedRows: number;
  pendingAfter: number;
  processingAfter: number;
  failedAfter: number;
};

type SyncOutboxWorkerOptions = {
  now?: () => string;
  batchSize?: number;
  staleProcessingMinutes?: number;
  transport?: SyncOutboxTransport;
};

const logger = getDesktopLogger("sync-outbox-worker");

const addMinutes = (value: string, minutes: number) => {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
};

const subtractMinutes = (value: string, minutes: number) => {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  return date.toISOString();
};

const resolveRetryDelayMinutes = (attemptCount: number) => {
  if (attemptCount <= 1) {
    return 1;
  }

  return Math.min(60, 2 ** (attemptCount - 1));
};

const recoverableRemoteErrorPattern =
  /(schema cache|could not find the .* column|pgrst204|failed to fetch|networkerror|network request failed|load failed|temporarily unavailable|timeout|timed out|idx_txn_links_dedupe_v4)/i;

const isRecoverableRemoteError = (message: string | null | undefined) =>
  Boolean(message && recoverableRemoteErrorPattern.test(message));

const resolveRetryDelayForErrorMinutes = (attemptCount: number, message: string | null | undefined) => {
  if (isRecoverableRemoteError(message)) {
    return 1;
  }

  return resolveRetryDelayMinutes(attemptCount);
};

const MAX_PAYLOAD_DEPTH = 4;
const MAX_PAYLOAD_ARRAY_ITEMS = 10;
const MAX_PAYLOAD_OBJECT_KEYS = 20;
const MAX_PAYLOAD_STRING_LENGTH = 240;
const MAX_PAYLOAD_PREVIEW_LENGTH = 4_000;
const sensitivePayloadKey = /(^|_)(token|secret|password|authorization|api_key|access_token|refresh_token|service_role_key|anon_key|storage_path|file_path|saved_path|absolute_path|path|root|roots)$/i;

const truncateText = (value: string, limit = MAX_PAYLOAD_STRING_LENGTH) =>
  value.length > limit ? `${value.slice(0, limit)}… [truncated]` : value;

const sanitizePayloadValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncateText(redactSensitiveText(value));
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_PAYLOAD_ARRAY_ITEMS).map((item) => sanitizePayloadValue(item, depth + 1));
    if (value.length > MAX_PAYLOAD_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_PAYLOAD_ARRAY_ITEMS} more item(s) truncated]`);
    }
    return items;
  }

  if (typeof value !== "object") {
    return redactSensitiveText(String(value));
  }

  if (depth >= MAX_PAYLOAD_DEPTH) {
    return "[nested object truncated]";
  }

  const entries = Object.entries(value);
  const sanitizedEntries = entries.slice(0, MAX_PAYLOAD_OBJECT_KEYS).map(([key, entryValue]) => [
    key,
    sensitivePayloadKey.test(key) ? "[redacted]" : sanitizePayloadValue(entryValue, depth + 1),
  ]);

  if (entries.length > MAX_PAYLOAD_OBJECT_KEYS) {
    sanitizedEntries.push([
      "__truncatedFields",
      `[${entries.length - MAX_PAYLOAD_OBJECT_KEYS} more field(s) omitted]`,
    ]);
  }

  return Object.fromEntries(sanitizedEntries);
};

const sanitizeOutboxPayloadJson = (payloadJson: string) => {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return truncateText(JSON.stringify(sanitizePayloadValue(parsed), null, 2), MAX_PAYLOAD_PREVIEW_LENGTH);
  } catch {
    return truncateText(redactSensitiveText(payloadJson), MAX_PAYLOAD_PREVIEW_LENGTH);
  }
};

export const summarizeSyncOutboxWorker = (summary: SyncOutboxWorkerSummary) => {
  const parts = [
    summary.sentRows ? `${summary.sentRows} rows sent` : null,
    summary.failedRows ? `${summary.failedRows} rows scheduled for retry` : null,
    summary.recoveredStaleRows ? `${summary.recoveredStaleRows} stale processing rows recovered` : null,
    summary.skippedRows ? `${summary.skippedRows} rows skipped` : null,
    `${summary.pendingAfter} pending`,
    `${summary.failedAfter} failed`,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
};

const countByStatus = (db: DatabaseSync, status: SyncOutboxStatus) =>
  (
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM sync_outbox
          WHERE status = ?
        `,
      )
      .get(status) as { count: number }
  ).count;

const acknowledgeLocalTransport: SyncOutboxTransport = (row) => {
  const payload = JSON.parse(row.payload_json) as unknown;

  if (payload === null || typeof payload !== "object") {
    throw new Error("Outbox payload must be a JSON object.");
  }

  if (!row.entity_type.trim()) {
    throw new Error("Outbox row is missing entity_type.");
  }

  if (!row.operation_type.trim()) {
    throw new Error("Outbox row is missing operation_type.");
  }

  return undefined;
};

export const createSyncOutboxWorkerService = (db: DatabaseSync, options: SyncOutboxWorkerOptions = {}) => {
  let isRunning = false;

  const now = () => options.now?.() ?? new Date().toISOString();
  const batchSize = Math.max(1, options.batchSize ?? 25);
  const staleProcessingMinutes = Math.max(1, options.staleProcessingMinutes ?? 5);
  const transport = options.transport ?? acknowledgeLocalTransport;

  const recoverStaleProcessingRows = (timestamp: string) => {
    const staleCutoff = subtractMinutes(timestamp, staleProcessingMinutes);

    return Number(
      db
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'failed',
              last_error = COALESCE(last_error, 'Recovered after an interrupted local sync attempt.'),
              next_retry_at = ?,
              updated_at = ?
            WHERE status = 'processing'
              AND updated_at < ?
          `,
        )
        .run(timestamp, timestamp, staleCutoff).changes,
    );
  };

  const recoverRetryableRemoteRows = (timestamp: string) =>
    Number(
      db
        .prepare(
          `
            UPDATE sync_outbox
            SET
              next_retry_at = ?,
              updated_at = ?
            WHERE status = 'failed'
              AND next_retry_at IS NOT NULL
              AND (
                lower(COALESCE(last_error, '')) LIKE '%schema cache%'
                OR lower(COALESCE(last_error, '')) LIKE '%could not find the % column%'
                OR lower(COALESCE(last_error, '')) LIKE '%pgrst204%'
                OR lower(COALESCE(last_error, '')) LIKE '%failed to fetch%'
                OR lower(COALESCE(last_error, '')) LIKE '%networkerror%'
                OR lower(COALESCE(last_error, '')) LIKE '%network request failed%'
                OR lower(COALESCE(last_error, '')) LIKE '%load failed%'
                OR lower(COALESCE(last_error, '')) LIKE '%temporarily unavailable%'
                OR lower(COALESCE(last_error, '')) LIKE '%timeout%'
                OR lower(COALESCE(last_error, '')) LIKE '%timed out%'
                OR lower(COALESCE(last_error, '')) LIKE '%idx_txn_links_dedupe_v4%'
              )
          `,
        )
        .run(timestamp, timestamp).changes,
    );

  const getCounts = () => ({
    pending: countByStatus(db, "pending"),
    processing: countByStatus(db, "processing"),
    failed: countByStatus(db, "failed"),
  });

  return {
    getCounts,

    listRows(limit = 25): AppSyncOutboxRow[] {
      const rows = db
        .prepare(
          `
            SELECT
              id,
              entity_type,
              entity_id,
              operation_type,
              status,
              attempt_count,
              last_error,
              next_retry_at,
              updated_at,
              payload_json
            FROM sync_outbox
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
          `,
        )
        .all(limit) as Array<{
        id: string;
        entity_type: string;
        entity_id: string;
        operation_type: string;
        status: AppSyncOutboxRow["status"];
        attempt_count: number;
        last_error: string | null;
        next_retry_at: string | null;
        updated_at: string;
        payload_json: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operationType: row.operation_type,
        status: row.status,
        attemptCount: row.attempt_count,
        lastError: row.last_error,
        nextRetryAt: row.next_retry_at,
        updatedAt: row.updated_at,
        payloadJson: sanitizeOutboxPayloadJson(row.payload_json),
      }));
    },

    retryRow(id: string) {
      const timestamp = now();
      const result = db
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'pending',
              last_error = NULL,
              next_retry_at = NULL,
              updated_at = ?
            WHERE id = ?
              AND status IN ('failed', 'processing')
          `,
        )
        .run(timestamp, id);

      return result.changes > 0;
    },

    retryAllFailedRows() {
      const timestamp = now();
      const result = db
        .prepare(
          `
            UPDATE sync_outbox
            SET
              status = 'pending',
              last_error = NULL,
              next_retry_at = NULL,
              updated_at = ?
            WHERE status = 'failed'
          `,
        )
        .run(timestamp);

      const retriedCount = Number(result.changes);
      logger.info("Marked failed sync rows as pending again.", { retriedCount });
      return retriedCount;
    },

    async runDueEntries(): Promise<SyncOutboxWorkerSummary> {
      if (isRunning) {
        const counts = getCounts();
        return {
          recoveredStaleRows: 0,
          processedRows: 0,
          sentRows: 0,
          failedRows: 0,
          skippedRows: 0,
          pendingAfter: counts.pending,
          processingAfter: counts.processing,
          failedAfter: counts.failed,
        };
      }

      isRunning = true;
      const startedAt = now();

      try {
        const recoveredStaleRows = recoverStaleProcessingRows(startedAt);
        const recoveredRetryableRows = recoverRetryableRemoteRows(startedAt);
        const dueRows = db
          .prepare(
            `
              SELECT *
              FROM sync_outbox
              WHERE status IN ('pending', 'failed')
                AND (next_retry_at IS NULL OR next_retry_at <= ?)
              ORDER BY created_at ASC
              LIMIT ?
            `,
          )
          .all(startedAt, batchSize) as SyncOutboxRow[];

        let processedRows = 0;
        let sentRows = 0;
        let failedRows = 0;
        let skippedRows = 0;

        for (const row of dueRows) {
          const claimed = db
            .prepare(
              `
                UPDATE sync_outbox
                SET
                  status = 'processing',
                  attempt_count = attempt_count + 1,
                  updated_at = ?
                WHERE id = ?
                  AND status IN ('pending', 'failed')
              `,
            )
            .run(startedAt, row.id);

          if (!claimed.changes) {
            skippedRows += 1;
            continue;
          }

          const claimedRow = db
            .prepare(
              `
                SELECT *
                FROM sync_outbox
                WHERE id = ?
                LIMIT 1
              `,
            )
            .get(row.id) as SyncOutboxRow | undefined;

          if (!claimedRow) {
            skippedRows += 1;
            continue;
          }

          processedRows += 1;

          try {
            await transport(claimedRow);
            db
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    status = 'sent',
                    last_error = NULL,
                    next_retry_at = NULL,
                    updated_at = ?
                  WHERE id = ?
                `,
              )
              .run(now(), claimedRow.id);
            sentRows += 1;
            logger.debug("Sent sync row.", {
              id: claimedRow.id,
              entityType: claimedRow.entity_type,
              operationType: claimedRow.operation_type,
            });
          } catch (error) {
            const retryTimestamp = now();
            const errorMessage = error instanceof Error ? error.message : String(error);
            const retryDelayMinutes = resolveRetryDelayForErrorMinutes(claimedRow.attempt_count, errorMessage);
            db
              .prepare(
                `
                  UPDATE sync_outbox
                  SET
                    status = 'failed',
                    last_error = ?,
                    next_retry_at = ?,
                    updated_at = ?
                  WHERE id = ?
                `,
              )
              .run(
                error instanceof Error ? error.message : "Local sync worker failed to process this row.",
                addMinutes(retryTimestamp, retryDelayMinutes),
                retryTimestamp,
                claimedRow.id,
              );
            failedRows += 1;
            logger.warn("Sync row failed and was scheduled for retry.", {
              id: claimedRow.id,
              entityType: claimedRow.entity_type,
              operationType: claimedRow.operation_type,
              attemptCount: claimedRow.attempt_count,
              nextRetryAt: addMinutes(retryTimestamp, retryDelayMinutes),
              error: errorMessage,
            });
          }
        }

        const counts = getCounts();

        const summary = {
          recoveredStaleRows: recoveredStaleRows + recoveredRetryableRows,
          processedRows,
          sentRows,
          failedRows,
          skippedRows,
          pendingAfter: counts.pending,
          processingAfter: counts.processing,
          failedAfter: counts.failed,
        };

        logger.info("Finished local sync worker pass.", summary);

        return summary;
      } finally {
        isRunning = false;
      }
    },
  };
};

export type SyncOutboxWorkerService = ReturnType<typeof createSyncOutboxWorkerService>;
