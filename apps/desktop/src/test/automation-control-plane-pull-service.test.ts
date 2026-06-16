import { describe, expect, it } from "vitest";

import { createAutomationControlPlanePullService } from "../../electron/main/services/data/automationControlPlanePullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("automationControlPlanePullService", () => {
  it("applies remote provider rows and advances the pull cursor", () => {
    const { cleanup, database } = createTestDatabase("bukowski-automation-pull-provider");
    const service = createAutomationControlPlanePullService(database);

    const providerRow = database
      .prepare(
        `
          SELECT id
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = 'openai'
          LIMIT 1
        `,
      )
      .get("workspace-metadata") as { id: string } | undefined;
    expect(providerRow?.id).toBeTruthy();

    const remoteUpdatedAt = "2026-06-16T15:30:00.000Z";
    const result = service.applyRemoteRows("workspace-metadata", "ai_provider_configs", [
      {
        id: providerRow?.id ?? "",
        workspace_id: "workspace-metadata",
        provider_key: "openai",
        display_name: "OpenAI",
        supports_live_requests: 1,
        enabled: 1,
        default_model_key: "openai:gpt-5.4",
        fallback_model_key: "openai:gpt-5.4-mini",
        base_url: "https://api.openai.com",
        timeout_ms: 45000,
        retry_count: 2,
        status: "configured",
        last_tested_at: null,
        last_success_at: null,
        last_error_summary: null,
        notes: "Synced from remote workspace settings.",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: remoteUpdatedAt,
      },
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.cursorAfter).toBe(remoteUpdatedAt);

    const localRow = database
      .prepare(
        `
          SELECT base_url, fallback_model_key, notes, updated_at
          FROM ai_provider_configs
          WHERE id = ?
        `,
      )
      .get(providerRow?.id ?? "") as
      | { base_url: string; fallback_model_key: string; notes: string | null; updated_at: string }
      | undefined;

    expect(localRow).toEqual({
      base_url: "https://api.openai.com",
      fallback_model_key: "openai:gpt-5.4-mini",
      notes: "Synced from remote workspace settings.",
      updated_at: remoteUpdatedAt,
    });

    cleanup();
  });

  it("keeps local pending agent changes ahead of remote pull rows", () => {
    const { cleanup, database } = createTestDatabase("bukowski-automation-pull-outbox-guard");
    const service = createAutomationControlPlanePullService(database);
    const localUpdatedAt = "2026-06-16T16:00:00.000Z";

    database
      .prepare(
        `
          UPDATE agents
          SET display_name = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND id = ?
        `,
      )
      .run("Assets Agent Local Draft", localUpdatedAt, "workspace-metadata", "agent-assets");

    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            operation_type,
            payload_json,
            status,
            attempt_count,
            last_error,
            next_retry_at,
            created_at,
            updated_at
          ) VALUES (?, ?, 'agent', ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)
        `,
      )
      .run(
        "sync-agent-local-draft",
        "workspace-metadata",
        "agent-assets",
        JSON.stringify({ id: "agent-assets" }),
        localUpdatedAt,
        localUpdatedAt,
        localUpdatedAt,
      );

    const result = service.applyRemoteRows("workspace-metadata", "agents", [
      {
        id: "agent-assets",
        workspace_id: "workspace-metadata",
        agent_key: "assets-agent",
        display_name: "Assets Agent Remote",
        role_summary: "Remote value should be skipped while local outbox is pending.",
        domain_key: "assets",
        provider_key: "openai",
        model_key: "openai:gpt-5.4",
        model_label: "GPT-5.4",
        status: "active",
        approval_mode: "supervised",
        allowed_tools_json: "[]",
        allowed_domains_json: "[]",
        notes: null,
        is_supervisor: 0,
        sort_order: 2,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-16T16:05:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.skippedDueToOutboxCount).toBe(1);

    const localRow = database
      .prepare("SELECT display_name, updated_at FROM agents WHERE id = ?")
      .get("agent-assets") as { display_name: string; updated_at: string } | undefined;

    expect(localRow).toEqual({
      display_name: "Assets Agent Local Draft",
      updated_at: localUpdatedAt,
    });

    cleanup();
  });
});
