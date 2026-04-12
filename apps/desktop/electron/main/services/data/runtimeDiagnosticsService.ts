import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { getDesktopLogger } from "../logger";

const workspaceId = DEFAULT_WORKSPACE_ID;
const logger = getDesktopLogger("runtime-diagnostics");

export type RecordRuntimeErrorInput = {
  sourceKind: "main" | "renderer" | "webcontents";
  processLabel: string;
  errorName: string;
  message: string;
  stack?: string | null;
  severity?: "low" | "medium" | "critical";
  context?: Record<string, unknown> | null;
  threadId?: string | null;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const buildFingerprint = (input: RecordRuntimeErrorInput) =>
  [
    input.sourceKind,
    normalizeText(input.processLabel),
    normalizeText(input.errorName),
    normalizeText(input.message).slice(0, 160),
  ].join(":");

type RuntimeSupportEventSummary = {
  id: string;
  occurredAt: string;
  sourceKind: "main" | "renderer" | "webcontents";
  processLabel: string;
  errorName: string;
  message: string;
  severity: "low" | "medium" | "critical";
  fingerprint: string;
};

const mapSupportEventRow = (row: {
  id: string;
  source_kind: "main" | "renderer" | "webcontents";
  process_label: string;
  error_name: string;
  message: string;
  severity: "low" | "medium" | "critical";
  fingerprint: string;
  created_at: string;
}): RuntimeSupportEventSummary => ({
  id: row.id,
  occurredAt: row.created_at,
  sourceKind: row.source_kind,
  processLabel: row.process_label,
  errorName: row.error_name,
  message: row.message,
  severity: row.severity,
  fingerprint: row.fingerprint,
});

export const createRuntimeDiagnosticsService = (db: DatabaseSync) => ({
  getSupportSnapshot() {
    const lastCrashRow = db
      .prepare(
        `
          SELECT id, source_kind, process_label, error_name, message, severity, fingerprint, created_at
          FROM runtime_error_events
          WHERE error_name IN ('uncaughtException', 'unhandledRejection', 'render-process-gone')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get() as
      | {
          id: string;
          source_kind: "main" | "renderer" | "webcontents";
          process_label: string;
          error_name: string;
          message: string;
          severity: "low" | "medium" | "critical";
          fingerprint: string;
          created_at: string;
        }
      | undefined;

    const lastErrorRow = db
      .prepare(
        `
          SELECT id, source_kind, process_label, error_name, message, severity, fingerprint, created_at
          FROM runtime_error_events
          WHERE severity IN ('medium', 'critical')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get() as
      | {
          id: string;
          source_kind: "main" | "renderer" | "webcontents";
          process_label: string;
          error_name: string;
          message: string;
          severity: "low" | "medium" | "critical";
          fingerprint: string;
          created_at: string;
        }
      | undefined;

    const lastLoadFailureRow = db
      .prepare(
        `
          SELECT id, source_kind, process_label, error_name, message, severity, fingerprint, created_at
          FROM runtime_error_events
          WHERE error_name IN ('did-fail-load', 'render-process-gone')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get() as
      | {
          id: string;
          source_kind: "main" | "renderer" | "webcontents";
          process_label: string;
          error_name: string;
          message: string;
          severity: "low" | "medium" | "critical";
          fingerprint: string;
          created_at: string;
        }
      | undefined;

    const recentCriticalRows = db
      .prepare(
        `
          SELECT id, source_kind, process_label, error_name, message, severity, fingerprint, created_at
          FROM runtime_error_events
          WHERE severity = 'critical'
          ORDER BY created_at DESC
          LIMIT 5
        `,
      )
      .all() as Array<{
      id: string;
      source_kind: "main" | "renderer" | "webcontents";
      process_label: string;
      error_name: string;
      message: string;
      severity: "low" | "medium" | "critical";
      fingerprint: string;
      created_at: string;
    }>;

    return {
      lastCrash: lastCrashRow ? mapSupportEventRow(lastCrashRow) : null,
      lastError: lastErrorRow ? mapSupportEventRow(lastErrorRow) : null,
      lastLoadFailure: lastLoadFailureRow ? mapSupportEventRow(lastLoadFailureRow) : null,
      recentCriticalEvents: recentCriticalRows.map(mapSupportEventRow),
    };
  },

  recordRuntimeError(input: RecordRuntimeErrorInput) {
    const id = `runtime-error-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const fingerprint = buildFingerprint(input);

    db.prepare(
      `
        INSERT INTO runtime_error_events (
          id,
          workspace_id,
          source_kind,
          process_label,
          severity,
          error_name,
          message,
          stack,
          fingerprint,
          context_json,
          thread_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      workspaceId,
      input.sourceKind,
      input.processLabel,
      input.severity ?? "medium",
      input.errorName,
      input.message,
      input.stack ?? null,
      fingerprint,
      input.context ? JSON.stringify(input.context) : null,
      input.threadId ?? null,
      createdAt,
    );

    db.prepare(
      `
        INSERT INTO agent_activity_events (
          id,
          workspace_id,
          agent_id,
          run_id,
          kind,
          title,
          body,
          tone,
          source,
          details_json,
          created_at
        ) VALUES (?, ?, NULL, NULL, 'runtime_error_captured', ?, ?, 'critical', 'system', ?, ?)
      `,
    ).run(
      `agent-activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId,
      `${input.processLabel} runtime error`,
      `${input.errorName}: ${input.message}`,
      JSON.stringify({
        runtime_error_id: id,
        source_kind: input.sourceKind,
        severity: input.severity ?? "medium",
        fingerprint,
      }),
      createdAt,
    );

    logger.error(`Captured ${input.sourceKind} runtime error ${input.errorName}`, {
      processLabel: input.processLabel,
      severity: input.severity ?? "medium",
      message: input.message,
      fingerprint,
    });

    return { id, fingerprint, createdAt };
  },
});

export type RuntimeDiagnosticsService = ReturnType<typeof createRuntimeDiagnosticsService>;
