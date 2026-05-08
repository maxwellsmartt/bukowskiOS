import { describe, expect, it } from "vitest";

import { createAgentToolRegistry } from "../../electron/main/services/ai/agentToolRegistry";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("agent tool registry", () => {
  it("exposes the expanded supervisor, projects, assets, incidents and finance tools", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });

    const toolNames = registry.definitions.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_agent_capabilities",
        "get_pending_approvals",
        "get_runs_by_agent",
        "get_agent_health_status",
        "get_tool_coverage_snapshot",
        "search_active_projects",
        "get_project_detail",
        "get_project_conflicts",
        "get_project_crew_allocations",
        "get_asset_availability",
        "get_asset_location",
        "get_asset_movements",
        "get_asset_reservations",
        "get_kit_contents",
        "search_incidents",
        "get_incident_detail",
        "get_incident_timeline",
        "get_incident_estimates",
        "get_maintenance_queue",
        "get_asset_maintenance_history",
        "get_project_financials",
        "get_budget_vs_actual",
        "get_monthly_burn_rate",
        "get_expense_breakdown",
        "get_financial_health",
        "get_incident_costs",
        "get_asset_exposure",
        "get_open_invoices",
        "get_reserves_status",
        "list_recipients",
        "get_thread_context",
        "preview_send_targets",
        "get_delivery_status",
        "draft_message",
        "search_errors",
        "get_error_detail",
        "get_session_trace",
        "get_recent_deploys",
        "get_agent_failures",
        "draft_bug_report",
        "get_user_feedback",
        "get_feature_usage",
        "get_funnel_dropoffs",
        "get_backlog_items",
        "link_feedback_to_feature",
      ]),
    );

    cleanup();
  });

  it("registers write tools when writeServices are provided and marks them as approval-required", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-write");
    const secretStore = { hasProviderSecret: () => false };

    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });

    // Cast as any because we only check registration shape, not real execution.
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        packing: noopMutation("packing"),
        projects: noopMutation("projects"),
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        assets: noopMutation("assets"),
        finance: noopMutation("finance"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    const toolNames = registry.definitions.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "create_incident",
        "update_incident",
        "create_rma",
        "create_packing_slip",
      ]),
    );

    expect(registry.requiresApproval("create_incident")).toBe(true);
    expect(registry.requiresApproval("update_incident")).toBe(true);
    expect(registry.requiresApproval("create_rma")).toBe(true);
    expect(registry.requiresApproval("create_packing_slip")).toBe(true);
    expect(registry.requiresApproval("get_asset_availability")).toBe(false);

    const approvalRequiredToolNames = ["create_incident", "update_incident", "create_rma", "create_packing_slip"];
    const writeDefs = registry.definitions.filter((tool) => approvalRequiredToolNames.includes(tool.name));
    expect(writeDefs).toHaveLength(approvalRequiredToolNames.length);
    for (const tool of writeDefs) {
      expect((tool as { requiresApproval?: boolean }).requiresApproval).toBe(true);
    }

    cleanup();
  });

  it("returns compact operational payloads for the new tools", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-payload");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
      )
      .run(
        "thread-communications-test",
        "workspace-metadata",
        "Comms thread",
        "agents",
        "Agents",
        "Reminder draft context",
        now,
        now,
      );

    database
      .prepare(
        `
          INSERT INTO assistant_chat_thread_state (
            thread_id,
            last_state,
            last_error_code,
            last_error_summary,
            last_routed_agent_id,
            last_intent,
            active_message_id,
            previous_response_id,
            recent_user_messages_json,
            last_tool_result_summary,
            session_approval_agent_id,
            session_approval_granted_at,
            is_active,
            updated_at
          ) VALUES (?, 'completed', NULL, NULL, NULL, 'draft_message', NULL, NULL, '[]', NULL, NULL, NULL, 1, ?)
        `,
      )
      .run("thread-communications-test", now);

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
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, NULL)
        `,
      )
      .run(
        "message-communications-test",
        "thread-communications-test",
        "user",
        "Prepare a reminder for overdue returns.",
        JSON.stringify({ label: "Needs approval", routedAgentName: "Communications Agent" }),
        now,
        now,
      );

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
          ) VALUES (?, ?, NULL, NULL, 'product_feedback', ?, ?, 0.92, ?, ?, 'manual_promotion', 'active', ?, ?)
        `,
      )
      .run(
        "memory-product-feedback-test",
        "workspace-metadata",
        "The chat approval card should be easier to scan on small screens.",
        "product_feedback:approval card should be easier to scan on small screens",
        "thread-communications-test",
        "message-communications-test",
        now,
        now,
      );

    database
      .prepare(
        `
          INSERT INTO agent_runs (
            id,
            workspace_id,
            agent_id,
            routed_by_agent_id,
            source_channel,
            title,
            input_summary,
            output_summary,
            status,
            approval_mode,
            approval_required,
            created_at,
            updated_at,
            source,
            details_json,
            thread_id,
            approval_decision,
            approval_scope,
            approval_decided_at
          )
          SELECT ?, ?, id, NULL, 'chat', ?, ?, ?, 'structured_error', 'supervised', 0, ?, ?, 'ai_gateway', '{}', ?, NULL, NULL, NULL
          FROM agents
          WHERE agent_key = 'bugs-agent'
          LIMIT 1
        `,
      )
      .run(
        "run-bugs-error-test",
        "workspace-metadata",
        "Review broken approval flow",
        "User reported a broken approval flow.",
        "Draft failed because the session trace could not be parsed.",
        now,
        now,
        "thread-communications-test",
      );

    database
      .prepare(
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
          ) VALUES (?, ?, 'renderer', 'Renderer', 'medium', 'TypeError', 'Cannot read properties of undefined', 'TypeError: stack preview', ?, ?, ?, ?)
        `,
      )
      .run(
        "runtime-error-test",
        "workspace-metadata",
        "renderer:typeerror:cannot read properties of undefined",
        JSON.stringify({ pathname: "/agents/chat", component: "GlobalAssistantChat" }),
        "thread-communications-test",
        now,
      );

    const capabilities = registry.execute("list_agent_capabilities", "{}", {
      workspaceId: "workspace-metadata",
      activePath: "/agents/mission-control",
      currentView: "Agents",
    });
    const projects = registry.execute(
      "search_active_projects",
      JSON.stringify({ query: "Aurora", limit: 3 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/projects",
        currentView: "Projects",
      },
    );
    const reservations = registry.execute(
      "get_asset_reservations",
      JSON.stringify({ query: "Alexa", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/assets",
        currentView: "Assets",
      },
    );
    const incidentDetail = registry.execute(
      "get_incident_detail",
      JSON.stringify({ incident_id: "incident-cine7-scratch" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/incidents",
        currentView: "Incidents",
      },
    );
    const finance = registry.execute(
      "get_project_financials",
      JSON.stringify({ project_id: "project-aurora" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    );
    const budgetVsActual = registry.execute(
      "get_budget_vs_actual",
      JSON.stringify({ project_id: "project-aurora" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    );
    const burnRate = registry.execute(
      "get_monthly_burn_rate",
      JSON.stringify({ project_id: "project-aurora", months: 4 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    );
    const expenseBreakdown = registry.execute(
      "get_expense_breakdown",
      JSON.stringify({ project_id: "project-aurora", period: "quarter" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    );
    const financialHealth = registry.execute(
      "get_financial_health",
      JSON.stringify({ project_id: "project-aurora", period: "month" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
      },
    );
    const recipients = registry.execute(
      "list_recipients",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const threadContext = registry.execute(
      "get_thread_context",
      JSON.stringify({ thread_id: "thread-communications-test", limit: 4 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const preview = registry.execute(
      "preview_send_targets",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const deliveryStatus = registry.execute(
      "get_delivery_status",
      JSON.stringify({ thread_id: "thread-communications-test", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const draft = registry.execute(
      "draft_message",
      JSON.stringify({
        purpose: "Reminder about overdue returns",
        recipient_label: "Alex",
        language: "es",
        key_points: ["Hay equipos pendientes de devolución", "Necesitamos confirmar la fecha de retorno"],
      }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const errors = registry.execute(
      "search_errors",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const errorDetail = registry.execute(
      "get_error_detail",
      JSON.stringify({ issue_id: "run:run-bugs-error-test" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const runtimeErrorDetail = registry.execute(
      "get_error_detail",
      JSON.stringify({ issue_id: "runtime:runtime-error-test" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const sessionTrace = registry.execute(
      "get_session_trace",
      JSON.stringify({ thread_id: "thread-communications-test", limit: 6 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/chat",
        currentView: "Agents",
      },
    );
    const deploys = registry.execute(
      "get_recent_deploys",
      JSON.stringify({ limit: 3 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const agentFailures = registry.execute(
      "get_agent_failures",
      JSON.stringify({ agent_key: "bugs-agent", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const bugReport = registry.execute(
      "draft_bug_report",
      JSON.stringify({ issue_id: "run:run-bugs-error-test", audience: "engineering" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const userFeedback = registry.execute(
      "get_user_feedback",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const featureUsage = registry.execute(
      "get_feature_usage",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const funnelDropoffs = registry.execute(
      "get_funnel_dropoffs",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const backlog = registry.execute(
      "get_backlog_items",
      JSON.stringify({ limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );
    const linkedFeedback = registry.execute(
      "link_feedback_to_feature",
      JSON.stringify({
        feedback: "The approval card is still too dense on small screens.",
        feature_area: "Agent approvals",
      }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/agents/mission-control",
        currentView: "Agents",
      },
    );

    expect((capabilities.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((projects.result.payload.items as Array<{ name: string }>)[0]?.name).toContain("Aurora");
    expect((reservations.result.payload.items as Array<unknown>).length).toBeGreaterThanOrEqual(0);
    expect((incidentDetail.result.payload.incident as { title?: string } | null)?.title).toBeTruthy();
    expect((finance.result.payload.project as { name?: string } | null)?.name).toContain("Aurora");
    expect((budgetVsActual.result.payload.project as { name?: string } | null)?.name).toContain("Aurora");
    expect((budgetVsActual.result.payload.hasExplicitBudget as boolean)).toBe(false);
    expect((burnRate.result.payload.series as Array<unknown>).length).toBe(4);
    expect((expenseBreakdown.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((financialHealth.result.payload.scope as string).length).toBeGreaterThan(0);
    expect((recipients.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((threadContext.result.payload.thread as { title?: string } | null)?.title).toContain("Comms");
    expect((preview.result.payload.reachableTargets as number) + (preview.result.payload.missingContactTargets as number)).toBeGreaterThanOrEqual(0);
    expect(deliveryStatus.result.payload.deliveryEnabled).toBe(false);
    expect((draft.result.payload.body as string)).toContain("Hola Alex");
    expect((errors.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((errors.result.payload.items as Array<{ severity?: string }>)[0]?.severity).toBeTruthy();
    expect((errorDetail.result.payload.issue as { title?: string } | null)?.title).toContain("Review broken approval flow");
    expect(((errorDetail.result.payload.issue as { suggestedChecks?: string[] } | null)?.suggestedChecks ?? []).length).toBeGreaterThan(0);
    expect((runtimeErrorDetail.result.payload.issue as { sourceType?: string } | null)?.sourceType).toBe("runtime");
    expect((sessionTrace.result.payload.messages as Array<unknown>).length).toBeGreaterThan(0);
    expect((sessionTrace.result.payload.activity as Array<unknown>).length).toBeGreaterThanOrEqual(0);
    expect(deploys.result.payload.telemetryAvailable).toBe(false);
    expect((agentFailures.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect(typeof (agentFailures.result.payload.byStatus as Record<string, number>).structured_error).toBe("number");
    expect(bugReport.result.payload.status).toBe("draft_only");
    expect((bugReport.result.payload.title as string)).toContain("[Bug]");
    expect((userFeedback.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((featureUsage.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((funnelDropoffs.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((backlog.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect(linkedFeedback.result.payload.status).toBe("draft_only");

    cleanup();
  });

  it("searches the full workspace inventory by default even from a project context", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-asset-workspace-scope");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });

    const workspaceSearch = registry.execute(
      "search_assets",
      JSON.stringify({ query: "Aputure", status: "Available", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/projects/project-aurora/info",
        currentView: "Project",
        activeProjectId: "project-aurora",
      },
    );
    const projectSearch = registry.execute(
      "search_assets",
      JSON.stringify({ query: "Aputure", status: "Available", scope: "project", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/projects/project-aurora/info",
        currentView: "Project",
        activeProjectId: "project-aurora",
      },
    );

    expect(workspaceSearch.result.payload.scope).toBe("workspace");
    expect((workspaceSearch.result.payload.items as Array<{ name: string }>).some((item) => item.name.includes("Aputure"))).toBe(true);
    expect(projectSearch.result.payload.scope).toBe("project");
    expect(projectSearch.result.payload.count).toBe(0);

    cleanup();
  });

  it("resolves projects from the active workspace instead of the default seed workspace", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-project-workspace-scope");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const now = new Date().toISOString();

    database
      .prepare(
        "INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
      )
      .run("workspace-cine2-test", "metadata-cine2-test", "Metadata Cine2 Test", "DOP", now, now);
    database
      .prepare(
        "INSERT INTO projects (id, workspace_id, code, name, client_name, status, start_date, end_date, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "project-agent-test-shoot",
        "workspace-cine2-test",
        "AGT",
        "Agent Test Shoot",
        "Metadata Cine",
        "Prep",
        "2026-06-01",
        "2026-06-03",
        "Agent smoke project",
        now,
        now,
      );

    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });

    const defaultWorkspaceSearch = registry.execute("search_projects", JSON.stringify({ query: "AGT", limit: 5 }), {
      workspaceId: "workspace-metadata",
      activePath: "/projects",
      currentView: "Projects",
    });
    const activeWorkspaceSearch = registry.execute("search_projects", JSON.stringify({ query: "AGT", limit: 5 }), {
      workspaceId: "workspace-cine2-test",
      activePath: "/projects",
      currentView: "Projects",
    });

    expect(defaultWorkspaceSearch.result.payload.count).toBe(0);
    expect((activeWorkspaceSearch.result.payload.items as Array<{ id: string }>)[0]?.id).toBe("project-agent-test-shoot");

    cleanup();
  });
});
