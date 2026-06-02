import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { describe, expect, it } from "vitest";

import { createDataRetentionService } from "../../electron/main/services/data/dataRetentionService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("data retention service", () => {
  it("archives stale low-confidence memory and purges safe historical records", () => {
    const { cleanup, database } = createTestDatabase("bukowski-retention");
    const attachmentPath = path.join(os.tmpdir(), `bukowski-retention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(attachmentPath, "temporary attachment");

    database.prepare(
      `
        INSERT INTO assistant_chat_threads (
          id, workspace_id, title, context_key, context_label, summary_text, created_at, updated_at, deleted_at
        ) VALUES (?, ?, 'Old thread', 'global', 'Global', '', ?, ?, ?)
      `,
    ).run("thread-retention-old", DEFAULT_WORKSPACE_ID, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO assistant_chat_messages (
          id, thread_id, role, body, message_state, state_payload_json, created_at, updated_at, deleted_at
        ) VALUES (?, ?, 'assistant', 'Old body', 'completed', NULL, ?, ?, ?)
      `,
    ).run("message-retention-old", "thread-retention-old", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO assistant_chat_attachments (
          id, thread_id, message_id, name, mime_type, storage_path, byte_size, status, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'old.txt', 'text/plain', ?, 18, 'deleted', ?, ?, ?)
      `,
    ).run(
      "attachment-retention-old",
      "thread-retention-old",
      "message-retention-old",
      attachmentPath,
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
    );

    database.prepare(
      `
        INSERT INTO assistant_memory_entries (
          id, workspace_id, agent_id, project_id, kind, body, normalized_key, confidence, source_thread_id, source_message_id, source_reason, status, created_at, updated_at
        ) VALUES
          ('memory-old-low', ?, NULL, NULL, 'preference', 'Old weak preference', 'preference|-|-|old weak preference', 0.3, NULL, NULL, 'repeated_preference', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
          ('memory-still-active', ?, NULL, NULL, 'stable_fact', 'Warehouse A is primary', 'stable_fact|-|-|warehouse a is primary', 0.9, NULL, NULL, 'stable_operational_fact', 'active', '2026-04-01T00:00:00.000Z', '2026-04-11T00:00:00.000Z')
      `,
    ).run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID);

    database.prepare(
      `
        INSERT INTO assistant_memory_events (
          id, workspace_id, entry_id, thread_id, message_id, event_kind, status, source_reason, body, created_at
        ) VALUES (?, ?, NULL, NULL, NULL, 'memory_candidate_skipped', 'skipped', 'repeated_preference', 'Old event', ?)
      `,
    ).run("memory-event-old", DEFAULT_WORKSPACE_ID, "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO runtime_error_events (
          id, workspace_id, source_kind, process_label, severity, error_name, message, stack, fingerprint, context_json, thread_id, created_at
        ) VALUES (?, ?, 'renderer', 'test', 'medium', 'Error', 'Old runtime error', NULL, 'renderer:test:error:old-runtime-error', NULL, NULL, ?)
      `,
    ).run("runtime-error-old", DEFAULT_WORKSPACE_ID, "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO sync_outbox (
          id, workspace_id, entity_type, entity_id, event_id, operation_type, payload_json, status, attempt_count, last_error, next_retry_at, created_at, updated_at
        ) VALUES
          ('sync-old-sent', ?, 'asset', 'asset-1', NULL, 'upsert', '{}', 'sent', 1, NULL, NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
          ('sync-pending', ?, 'asset', 'asset-2', NULL, 'upsert', '{}', 'pending', 0, NULL, NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
      `,
    ).run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID);

    const retention = createDataRetentionService(database, {
      now: () => "2026-04-12T12:00:00.000Z",
    });

    const summary = retention.run();

    const archivedMemory = database
      .prepare("SELECT status FROM assistant_memory_entries WHERE id = 'memory-old-low'")
      .get() as { status: string } | undefined;
    const activeMemory = database
      .prepare("SELECT status FROM assistant_memory_entries WHERE id = 'memory-still-active'")
      .get() as { status: string } | undefined;
    const deletedThread = database
      .prepare("SELECT id FROM assistant_chat_threads WHERE id = 'thread-retention-old'")
      .get() as { id: string } | undefined;
    const oldSentOutbox = database
      .prepare("SELECT id FROM sync_outbox WHERE id = 'sync-old-sent'")
      .get() as { id: string } | undefined;
    const pendingOutbox = database
      .prepare("SELECT id FROM sync_outbox WHERE id = 'sync-pending'")
      .get() as { id: string } | undefined;
    const oldRuntimeError = database
      .prepare("SELECT id FROM runtime_error_events WHERE id = 'runtime-error-old'")
      .get() as { id: string } | undefined;
    const oldMemoryEvent = database
      .prepare("SELECT id FROM assistant_memory_events WHERE id = 'memory-event-old'")
      .get() as { id: string } | undefined;

    expect(summary.archivedMemoryEntries).toBeGreaterThanOrEqual(1);
    expect(summary.deletedChatThreads).toBe(1);
    expect(summary.deletedAttachmentFiles).toBe(1);
    expect(summary.deletedSentOutboxRows).toBe(1);
    expect(summary.deletedRuntimeErrorRows).toBe(1);
    expect(summary.deletedMemoryEvents).toBe(1);
    expect(archivedMemory?.status).toBe("archived");
    expect(activeMemory?.status).toBe("active");
    expect(deletedThread).toBeUndefined();
    expect(oldSentOutbox).toBeUndefined();
    expect(pendingOutbox?.id).toBe("sync-pending");
    expect(oldRuntimeError).toBeUndefined();
    expect(oldMemoryEvent).toBeUndefined();
    expect(fs.existsSync(attachmentPath)).toBe(false);

    cleanup();
  });

  it("purges stale agent activity events while keeping recent ones", () => {
    const { cleanup, database } = createTestDatabase("bukowski-retention-activity");

    const insertActivity = database.prepare(
      `
        INSERT INTO agent_activity_events (
          id, workspace_id, agent_id, run_id, kind, title, body, tone, source, details_json, created_at
        ) VALUES (?, ?, NULL, NULL, 'runtime_error_captured', 'storm', 'storm', 'critical', 'system', NULL, ?)
      `,
    );
    insertActivity.run("activity-old", DEFAULT_WORKSPACE_ID, "2025-01-01T00:00:00.000Z");
    insertActivity.run("activity-recent", DEFAULT_WORKSPACE_ID, "2026-04-11T00:00:00.000Z");

    const retention = createDataRetentionService(database, { now: () => "2026-04-12T12:00:00.000Z" });
    const summary = retention.run();

    const oldActivity = database
      .prepare("SELECT id FROM agent_activity_events WHERE id = 'activity-old'")
      .get() as { id: string } | undefined;
    const recentActivity = database
      .prepare("SELECT id FROM agent_activity_events WHERE id = 'activity-recent'")
      .get() as { id: string } | undefined;

    expect(summary.deletedAgentActivityRows).toBe(1);
    expect(oldActivity).toBeUndefined();
    expect(recentActivity?.id).toBe("activity-recent");

    cleanup();
  });

  it("does not delete attachment files outside the configured attachments root", () => {
    const { cleanup, database } = createTestDatabase("bukowski-retention-path-escape");
    const attachmentsRootPath = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-retention-attachments-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-retention-outside-"));
    const outsideAttachmentPath = path.join(outsideRoot, "private.txt");
    fs.writeFileSync(outsideAttachmentPath, "do not delete");

    database.prepare(
      `
        INSERT INTO assistant_chat_threads (
          id, workspace_id, title, context_key, context_label, summary_text, created_at, updated_at, deleted_at
        ) VALUES (?, ?, 'Old thread', 'global', 'Global', '', ?, ?, ?)
      `,
    ).run("thread-retention-escape", DEFAULT_WORKSPACE_ID, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO assistant_chat_messages (
          id, thread_id, role, body, message_state, state_payload_json, created_at, updated_at, deleted_at
        ) VALUES (?, ?, 'assistant', 'Old body', 'completed', NULL, ?, ?, ?)
      `,
    ).run("message-retention-escape", "thread-retention-escape", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");

    database.prepare(
      `
        INSERT INTO assistant_chat_attachments (
          id, thread_id, message_id, name, mime_type, storage_path, byte_size, status, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'private.txt', 'text/plain', ?, 13, 'deleted', ?, ?, ?)
      `,
    ).run(
      "attachment-retention-escape",
      "thread-retention-escape",
      "message-retention-escape",
      outsideAttachmentPath,
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
    );

    const retention = createDataRetentionService(database, {
      attachmentsRootPath,
      now: () => "2026-04-12T12:00:00.000Z",
    });

    const summary = retention.run();

    expect(summary.deletedAttachmentFiles).toBe(0);
    expect(fs.existsSync(outsideAttachmentPath)).toBe(true);

    cleanup();
    fs.rmSync(attachmentsRootPath, { force: true, recursive: true });
    fs.rmSync(outsideRoot, { force: true, recursive: true });
  });
});
