import { describe, expect, it } from "vitest";

import { createAssistantMemoryService } from "../../electron/main/services/ai/assistantMemoryService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("assistant memory service", () => {
  it("filters overlay entries by scope in SQL and prunes stale low-confidence memories", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-memory");
    const memory = createAssistantMemoryService(database);
    const assetsAgent = database
      .prepare(
        `
          SELECT id
          FROM agents
          WHERE workspace_id = 'workspace-metadata'
            AND agent_key = 'assets-agent'
          LIMIT 1
        `,
      )
      .get() as { id: string } | undefined;

    database
      .prepare(
        `
          INSERT INTO assistant_memory_entries (
            id,
            workspace_id,
            agent_id,
            project_id,
            kind,
            body,
            normalized_key,
            confidence,
            source_thread_id,
            source_message_id,
            source_reason,
            status,
            created_at,
            updated_at
          ) VALUES
            ('memory-agent-1', 'workspace-metadata', ?, NULL, 'instruction', 'Always mention serial numbers.', 'instruction|assets-agent|-|always mention serial numbers.', 0.9, NULL, NULL, 'user_explicit_instruction', 'active', '2026-04-01T10:00:00.000Z', '2026-04-11T10:00:00.000Z'),
            ('memory-workspace-1', 'workspace-metadata', NULL, NULL, 'stable_fact', 'Warehouse A is the primary storage location.', 'stable_fact|-|-|warehouse a is the primary storage location.', 0.82, NULL, NULL, 'stable_operational_fact', 'active', '2026-04-01T10:00:00.000Z', '2026-04-10T10:00:00.000Z'),
            ('memory-project-1', 'workspace-metadata', NULL, 'project-aurora', 'stable_fact', 'Aurora needs camera inventory first.', 'stable_fact|-|project-aurora|aurora needs camera inventory first.', 0.8, NULL, NULL, 'project_specific_fact', 'active', '2026-04-01T10:00:00.000Z', '2026-04-09T10:00:00.000Z'),
            ('memory-stale-low', 'workspace-metadata', NULL, NULL, 'preference', 'Old weak preference.', 'preference|-|-|old weak preference.', 0.3, NULL, NULL, 'repeated_preference', 'active', '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z')
        `,
      )
      .run(assetsAgent?.id ?? null);

    // Standing memory must surface per scope regardless of the current message
    // — the overlay no longer requires the stored body to contain the user's
    // turn (that filter left real, full-sentence queries with an empty overlay).
    const overlay = memory.getOverlay({
      agentId: assetsAgent?.id ?? null,
      projectId: "project-aurora",
      query: "hicimos varios ajustes en el inventario hoy",
      limit: 6,
    });

    expect(overlay.agentEntries).toHaveLength(1);
    expect(overlay.agentEntries[0]?.body).toContain("serial numbers");
    // Two active workspace-scoped entries exist (Warehouse fact + the stale
    // low-confidence one not yet pruned); both surface, most recent first.
    expect(overlay.workspaceEntries).toHaveLength(2);
    expect(overlay.workspaceEntries[0]?.body).toContain("Warehouse A");
    expect(overlay.projectEntries).toHaveLength(1);
    expect(overlay.projectEntries[0]?.body).toContain("Aurora");

    memory.pruneStaleEntries({
      maxAgeDays: 30,
      maxCount: 500,
      minConfidence: 0.5,
    });

    const staleEntry = database
      .prepare(
        `
          SELECT status
          FROM assistant_memory_entries
          WHERE id = 'memory-stale-low'
        `,
      )
      .get() as { status: string };

    expect(staleEntry.status).toBe("archived");

    cleanup();
  });

  it("captures Spanish instructions and preferences (not only English)", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-memory-es");
    const memory = createAssistantMemoryService(database);
    const now = "2026-04-24T00:00:00.000Z";

    database
      .prepare(
        `
          INSERT INTO assistant_chat_threads (
            id, workspace_id, title, context_key, context_label, summary_text, created_at, updated_at, deleted_at
          ) VALUES (?, 'workspace-metadata', 'Memoria ES', '/agents/chat', 'App', '', ?, ?, NULL)
        `,
      )
      .run("thread-es-1", now, now);

    memory.extractAndPersist({
      message: "Recuerda que siempre debemos etiquetar los assets con el número de serie.",
      context: { activeProjectId: null },
      threadId: "thread-es-1",
      messageId: null,
      routedAgentId: null,
    });
    memory.extractAndPersist({
      message: "Prefiero que me respondas en español y de forma breve.",
      context: { activeProjectId: null },
      threadId: "thread-es-1",
      messageId: null,
      routedAgentId: null,
    });

    const overlay = memory.getOverlay({ agentId: null, projectId: null, query: "", limit: 6 });
    const bodies = overlay.workspaceEntries.map((entry) => entry.body).join(" || ");

    expect(overlay.workspaceEntries.length).toBeGreaterThanOrEqual(1);
    expect(bodies.toLowerCase()).toContain("número de serie");

    cleanup();
  });

  it("keeps personal preferences private per user while sharing workspace facts", () => {
    const { cleanup, database } = createTestDatabase("bukowski-assistant-memory-peruser");
    const memory = createAssistantMemoryService(database);
    const now = "2026-04-24T00:00:00.000Z";

    database
      .prepare(
        `
          INSERT INTO assistant_chat_threads (
            id, workspace_id, title, context_key, context_label, summary_text, created_at, updated_at, deleted_at
          ) VALUES (?, 'workspace-metadata', 'Memoria usuario', '/agents/chat', 'App', '', ?, ?, NULL)
        `,
      )
      .run("thread-user-1", now, now);

    // Personal preference (private to user-a) + a shared workspace fact.
    memory.extractAndPersist({
      message: "Prefiero que me respondas en español y de forma breve.",
      context: { activeProjectId: null },
      threadId: "thread-user-1",
      messageId: null,
      routedAgentId: null,
      userId: "user-a",
    });
    memory.extractAndPersist({
      message: "Usamos cámaras Sony en la productora.",
      context: { activeProjectId: null },
      threadId: "thread-user-1",
      messageId: null,
      routedAgentId: null,
      userId: "user-a",
    });

    const overlayA = memory.getOverlay({ agentId: null, projectId: null, query: "", limit: 6, userId: "user-a" });
    const bodiesA = overlayA.workspaceEntries.map((entry) => entry.body.toLowerCase());
    expect(bodiesA.some((body) => body.includes("español"))).toBe(true);
    expect(bodiesA.some((body) => body.includes("sony"))).toBe(true);

    const overlayB = memory.getOverlay({ agentId: null, projectId: null, query: "", limit: 6, userId: "user-b" });
    const bodiesB = overlayB.workspaceEntries.map((entry) => entry.body.toLowerCase());
    // user-b sees the shared fact but NOT user-a's private preference.
    expect(bodiesB.some((body) => body.includes("sony"))).toBe(true);
    expect(bodiesB.some((body) => body.includes("español"))).toBe(false);

    cleanup();
  });
});
