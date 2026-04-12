import type { DatabaseSync } from "node:sqlite";
import type { AppSyncOutboxRow } from "@contracts";

type SyncOutboxStatus = "pending" | "processing" | "failed" | "sent";

type SyncOutboxRow = {
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
};

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

export const summarizeSyncOutboxWorker = (summary: SyncOutboxWorkerSummary) => {
  const parts = [
    summary.sentRows ? `${summary.sentRows} rows acknowledged locally` : null,
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

const acknowledgeLocalTransport = (row: SyncOutboxRow) => {
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

  return {
    acceptedAt: new Date().toISOString(),
    entityType: row.entity_type,
    entityId: row.entity_id,
  };
};

export const createSyncOutboxWorkerService = (db: DatabaseSync, options: SyncOutboxWorkerOptions = {}) => {
  let isRunning = false;

  const now = () => options.now?.() ?? new Date().toISOString();
  const batchSize = Math.max(1, options.batchSize ?? 25);
  const staleProcessingMinutes = Math.max(1, options.staleProcessingMinutes ?? 5);

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
        payloadJson: row.payload_json,
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

      return Number(result.changes);
    },

    runDueEntries(): SyncOutboxWorkerSummary {
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

        dueRows.forEach((row) => {
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
            return;
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
            return;
          }

          processedRows += 1;

          try {
            acknowledgeLocalTransport(claimedRow);
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
          } catch (error) {
            const retryTimestamp = now();
            const retryDelayMinutes = resolveRetryDelayMinutes(claimedRow.attempt_count);
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
          }
        });

        const counts = getCounts();

        return {
          recoveredStaleRows,
          processedRows,
          sentRows,
          failedRows,
          skippedRows,
          pendingAfter: counts.pending,
          processingAfter: counts.processing,
          failedAfter: counts.failed,
        };
      } finally {
        isRunning = false;
      }
    },
  };
};

export type SyncOutboxWorkerService = ReturnType<typeof createSyncOutboxWorkerService>;
