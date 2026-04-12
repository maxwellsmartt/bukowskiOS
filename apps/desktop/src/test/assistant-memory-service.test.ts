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

    const overlay = memory.getOverlay({
      agentId: assetsAgent?.id ?? null,
      projectId: "project-aurora",
      query: "warehouse",
      limit: 6,
    });

    expect(overlay.agentEntries).toHaveLength(0);
    expect(overlay.workspaceEntries).toHaveLength(1);
    expect(overlay.workspaceEntries[0]?.body).toContain("Warehouse A");
    expect(overlay.projectEntries).toHaveLength(0);

    const broadOverlay = memory.getOverlay({
      agentId: assetsAgent?.id ?? null,
      projectId: "project-aurora",
      query: "",
      limit: 6,
    });

    expect(broadOverlay.agentEntries).toHaveLength(1);
    expect(broadOverlay.workspaceEntries).toHaveLength(2);
    expect(broadOverlay.projectEntries).toHaveLength(1);

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
});
