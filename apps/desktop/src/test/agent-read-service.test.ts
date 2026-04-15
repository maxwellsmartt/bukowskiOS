import { describe, expect, it } from "vitest";

import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("agent read service", () => {
  it("hydrates mission control, runs, models and connectors from the local database", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agents-test");
    const supervisor = database
      .prepare("SELECT id FROM agents WHERE workspace_id = ? AND is_supervisor = 1 LIMIT 1")
      .get("workspace-metadata") as { id: string } | undefined;
    database
      .prepare(
        `
          INSERT INTO agent_runs (
            id,
            workspace_id,
            agent_id,
            source_channel,
            title,
            input_summary,
            output_summary,
            status,
            approval_mode,
            approval_required,
            created_at,
            updated_at
          ) VALUES ('run-supervisor-working', ?, ?, 'chat', 'Supervisor check', 'Check state', 'Running', 'running', 'supervised', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run("workspace-metadata", supervisor?.id ?? null);

    const reads = createAgentReadService(database);
    const missionControl = reads.getMissionControlSnapshot();
    const agents = reads.getAgentsList();

    expect(missionControl.supervisor?.displayName).toBe("Supervisor Agent");
    expect(missionControl.supervisor?.modelLabel).toBeTruthy();
    expect(missionControl.supervisor?.operationalState).toBe("not_working");
    expect(missionControl.subagents.length).toBeGreaterThanOrEqual(5);
    expect(missionControl.subagents.every((agent) => Boolean(agent.modelLabel))).toBe(true);
    expect(missionControl.queue.length).toBeGreaterThan(0);
    expect(missionControl.activity.length).toBeGreaterThan(0);
    expect(agents.some((agent) => agent.displayName === "Assets Agent")).toBe(true);
    expect(agents.some((agent) => agent.role === "Assets Agent")).toBe(true);
    expect(reads.getRunsList().some((run) => run.status === "needs_approval")).toBe(true);
    expect(reads.getModelsSnapshot().providers.some((provider) => provider.providerKey === "openai")).toBe(true);
    expect(reads.getConnectorsSnapshot().some((connector) => connector.connectorKey === "telegram")).toBe(true);
    expect(
      reads.getConnectorsSnapshot().some((connector) => connector.connectorKey === "email" && connector.status === "configured"),
    ).toBe(false);

    cleanup();
  });

  it("hides internal agents from visible surfaces in production mode", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousShowInternal = process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS;
    process.env.NODE_ENV = "production";
    delete process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS;

    const { cleanup, database } = createTestDatabase("bukowski-agents-visibility-test");
    const reads = createAgentReadService(database);
    const visibleAgents = reads.getAgentsList();
    const missionControl = reads.getMissionControlSnapshot();

    expect(visibleAgents.some((agent) => agent.displayName === "Bugs Agent")).toBe(false);
    expect(visibleAgents.some((agent) => agent.displayName === "Product Agent")).toBe(false);
    expect(missionControl.subagents.some((agent) => agent.displayName === "Bugs Agent")).toBe(false);
    expect(missionControl.subagents.some((agent) => agent.displayName === "Product Agent")).toBe(false);

    cleanup();
    process.env.NODE_ENV = previousNodeEnv;
    if (previousShowInternal === undefined) {
      delete process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS;
    } else {
      process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS = previousShowInternal;
    }
  });

  it("marks a routed agent as working when Telegram activity completed moments ago", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agents-telegram-activity");
    database.prepare("UPDATE ai_provider_configs SET enabled = 1, status = 'healthy' WHERE workspace_id = ?").run("workspace-metadata");
    const assetsAgent = database
      .prepare("SELECT id FROM agents WHERE workspace_id = ? AND display_name = ? LIMIT 1")
      .get("workspace-metadata", "Assets Agent") as { id: string } | undefined;
    const now = new Date().toISOString();

    database
      .prepare(
        `
          INSERT INTO assistant_chat_threads (
            id,
            workspace_id,
            title,
            context_key,
            context_label,
            summary_text,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, 'workspace-metadata', 'Telegram check', '/agents/chat?connector=telegram', 'Telegram DM', '', ?, ?, NULL)
        `,
      )
      .run("assistant-thread-telegram-activity", now, now);

    database
      .prepare(
        `
          INSERT INTO assistant_chat_thread_state (
            thread_id,
            last_state,
            last_routed_agent_id,
            recent_user_messages_json,
            preferred_approval_mode,
            is_active,
            updated_at
          ) VALUES (?, 'completed', ?, '[]', 'supervised', 0, ?)
        `,
      )
      .run("assistant-thread-telegram-activity", assetsAgent?.id ?? null, now);

    database
      .prepare(
        `
          INSERT INTO assistant_chat_messages (
            id,
            thread_id,
            role,
            body,
            message_state,
            state_payload_json,
            source_connector_key,
            source_channel_id,
            source_external_message_id,
            source_actor_user_id,
            correlation_id,
            source_metadata_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, 'user', ?, 'sent', NULL, 'telegram', 'connector-channel-1', 'telegram-message-1', 'user-luis', 'telegram:test:1', '{}', ?, ?, NULL)
        `,
      )
      .run(
        "assistant-message-telegram-activity",
        "assistant-thread-telegram-activity",
        "Estado del monitor principal",
        now,
        now,
      );

    const missionControl = createAgentReadService(database).getMissionControlSnapshot();
    const graphAgent = missionControl.subagents.find((agent) => agent.displayName === "Assets Agent");

    expect(graphAgent?.operationalState).toBe("working");

    cleanup();
  });
});
