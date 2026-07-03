import { describe, expect, it } from "vitest";

import { createKitPullService } from "../../electron/main/services/data/kitPullService";
import { canAdvanceCompositePullCursor } from "@shared/lib/compositePullCursor";
import { createTestDatabase } from "./helpers/createTestDatabase";

const workspaceId = "22222222-2222-4222-8222-222222222222";

const insertWorkspace = (database: ReturnType<typeof createTestDatabase>["database"]) => {
  const now = "2026-07-03T12:00:00.000Z";
  database
    .prepare(
      `
        INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(workspaceId, "Kit Pull Workspace", "kit-pull-workspace", "USD", now, now);
};

describe("kit pull service", () => {
  it("defers cursor advancement when a remote kit references assets that are not local yet", () => {
    const { cleanup, database } = createTestDatabase("bukowski-kit-pull-missing-assets", { includeDemoData: false });
    const service = createKitPullService(database);
    insertWorkspace(database);

    const result = service.applyRemoteKits(
      workspaceId,
      [
        {
          id: "kit-remote-missing-asset",
          workspace_id: workspaceId,
          code: "REMOTE-KIT",
          name: "Remote Kit",
          description: null,
          notes: null,
          is_active: true,
          created_at: "2026-07-03T12:00:00.000Z",
          updated_at: "2026-07-03T12:05:00.000Z",
        },
      ],
      [
        {
          kit_id: "kit-remote-missing-asset",
          asset_id: "asset-not-local-yet",
          quantity: 1,
          added_at: "2026-07-03T12:01:00.000Z",
        },
      ],
    );

    const kit = database.prepare("SELECT id, code FROM kits WHERE id = ?").get("kit-remote-missing-asset");
    const memberCount = database
      .prepare("SELECT COUNT(*) AS count FROM kit_assets WHERE kit_id = ?")
      .get("kit-remote-missing-asset") as { count: number };
    const cursor = database
      .prepare("SELECT last_synced_at, last_error FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = 'kits'")
      .get(workspaceId) as { last_synced_at: string | null; last_error: string | null };

    expect(kit).toEqual({ id: "kit-remote-missing-asset", code: "REMOTE-KIT" });
    expect(memberCount.count).toBe(0);
    expect(result.missingAssetCount).toBe(1);
    expect(canAdvanceCompositePullCursor(result)).toBe(false);
    expect(cursor.last_synced_at).toBeNull();
    expect(cursor.last_error).toContain("assets that are not local yet");

    cleanup();
  });
});
