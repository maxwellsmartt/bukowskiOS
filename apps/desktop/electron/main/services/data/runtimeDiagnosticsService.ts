import type { DatabaseSync } from "node:sqlite";

const workspaceId = "workspace-metadata";

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

export const createRuntimeDiagnosticsService = (db: DatabaseSync) => ({
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

    return { id, fingerprint, createdAt };
  },
});

export type RuntimeDiagnosticsService = ReturnType<typeof createRuntimeDiagnosticsService>;
