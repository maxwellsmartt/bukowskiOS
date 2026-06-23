import { describe, expect, it } from "vitest";

import { createAgentToolRegistry } from "../../electron/main/services/ai/agentToolRegistry";
import { createCurrencyMutationService } from "../../electron/main/services/data/currencyMutationService";
import { createCurrencyReadService } from "../../electron/main/services/data/currencyReadService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createProjectMutationService } from "../../electron/main/services/data/projectMutationService";
import { applyNotificationLocalMigration, createNotificationLocalService } from "../../electron/main/services/data/notificationLocalService";
import { createQuoteMutationService } from "../../electron/main/services/data/quoteMutationService";
import { createQuoteReadService } from "../../electron/main/services/data/quoteReadService";
import { createInvoiceMutationService } from "../../electron/main/services/data/invoiceMutationService";
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
        "get_action_history",
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

  it("returns compact action history without leaking finance events to users without finance read permission", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-history");
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => [],
    });

    database
      .prepare(
        `
          INSERT OR REPLACE INTO command_receipts (
            command_id,
            workspace_id,
            actor_user_id,
            actor_type,
            source_channel,
            executed_at,
            outcome_status,
            error_message
          ) VALUES (?, 'workspace-metadata', NULL, 'agent', 'agent_tool', ?, 'succeeded', NULL)
        `,
      )
      .run("agent-assets-create-history-test", "2030-01-01T10:00:00.000Z");

    database
      .prepare(
        `
          INSERT OR REPLACE INTO command_receipts (
            command_id,
            workspace_id,
            actor_user_id,
            actor_type,
            source_channel,
            executed_at,
            outcome_status,
            error_message
          ) VALUES (?, 'workspace-metadata', NULL, 'agent', 'agent_tool', ?, 'succeeded', NULL)
        `,
      )
      .run("agent-quote-history-test", "2030-01-01T10:01:00.000Z");

    const assetHistory = registry.execute(
      "get_action_history",
      JSON.stringify({ entity_id: "agent-assets-create-history-test", limit: 5 }),
      { workspaceId: "workspace-metadata", userPermissions: [] },
    );
    const assetPayload = assetHistory.result.payload as { count: number; items: Array<{ domain: string; commandId?: string | null }> };
    expect(assetPayload.count).toBe(1);
    expect(assetPayload.items[0]?.domain).toBe("assets");
    expect(assetPayload.items[0]?.commandId).toBe("agent-assets-create-history-test");

    const hiddenFinanceHistory = registry.execute(
      "get_action_history",
      JSON.stringify({ entity_id: "agent-quote-history-test", limit: 5 }),
      { workspaceId: "workspace-metadata", userPermissions: [] },
    );
    const hiddenPayload = hiddenFinanceHistory.result.payload as { count: number; omittedDomains: string[]; items: Array<{ domain: string }> };
    expect(hiddenPayload.count).toBe(0);
    expect(hiddenPayload.omittedDomains).toContain("finance");

    const financeHistory = registry.execute(
      "get_action_history",
      JSON.stringify({ entity_id: "agent-quote-history-test", limit: 5 }),
      { workspaceId: "workspace-metadata", userPermissions: ["finance.read"] },
    );
    const financePayload = financeHistory.result.payload as { count: number; items: Array<{ domain: string; commandId?: string | null }> };
    expect(financePayload.count).toBe(1);
    expect(financePayload.items[0]?.domain).toBe("finance");
    expect(financePayload.items[0]?.commandId).toBe("agent-quote-history-test");

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
        "create_asset",
        "update_asset",
        "archive_asset",
        "assign_move_assets",
        "update_project_unit",
        "delete_project_unit",
        "list_todos",
        "complete_todo",
        "update_reminder",
        "cancel_reminder",
        "update_quote_draft",
        "create_invoice_from_quote",
      ]),
    );

    expect(registry.requiresApproval("create_incident")).toBe(true);
    expect(registry.requiresApproval("update_incident")).toBe(true);
    expect(registry.requiresApproval("create_rma")).toBe(true);
    expect(registry.requiresApproval("create_packing_slip")).toBe(true);
    expect(registry.requiresApproval("create_asset")).toBe(true);
    expect(registry.requiresApproval("update_asset")).toBe(true);
    expect(registry.requiresApproval("archive_asset")).toBe(true);
    expect(registry.requiresApproval("assign_move_assets")).toBe(true);
    expect(registry.requiresApproval("update_project_unit")).toBe(true);
    expect(registry.requiresApproval("delete_project_unit")).toBe(true);
    expect(registry.requiresApproval("list_todos")).toBe(false);
    expect(registry.requiresApproval("complete_todo")).toBe(false);
    expect(registry.requiresApproval("update_reminder")).toBe(false);
    expect(registry.requiresApproval("cancel_reminder")).toBe(false);
    expect(registry.requiresApproval("update_quote_draft")).toBe(true);
    expect(registry.requiresApproval("create_invoice_from_quote")).toBe(true);
    expect(registry.requiresApproval("get_asset_availability")).toBe(false);

    const approvalRequiredToolNames = [
      "create_incident",
      "update_incident",
      "create_rma",
      "create_packing_slip",
      "create_asset",
      "update_asset",
      "archive_asset",
      "assign_move_assets",
      "update_project_unit",
      "delete_project_unit",
      "update_quote_draft",
      "create_invoice_from_quote",
    ];
    const writeDefs = registry.definitions.filter((tool) => approvalRequiredToolNames.includes(tool.name));
    expect(writeDefs).toHaveLength(approvalRequiredToolNames.length);
    for (const tool of writeDefs) {
      expect((tool as { requiresApproval?: boolean }).requiresApproval).toBe(true);
    }

    cleanup();
  });

  it("updates quote drafts and creates invoices from approved quotes with separate permissions", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-finance-writes");
    const secretStore = { hasProviderSecret: () => false };
    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });
    const quoteMutations = createQuoteMutationService(database);
    const quoteReads = createQuoteReadService(database);
    const invoiceMutations = createInvoiceMutationService(database);
    const created = quoteMutations.createQuote({
      commandId: "cmd-agent-finance-quote-create",
      workspaceId: "workspace-metadata",
      actorType: "agent",
      sourceChannel: "desktop",
      quoteDate: "2026-06-23",
      validityDays: 15,
      clientNameSnapshot: "Metadata Client",
      currency: "DOP",
      baseCurrency: "DOP",
      exchangeRate: 1,
      exchangeRateSource: "manual",
      exchangeRateType: "manual",
      taxProfile: "standard_itbis",
      itbisRate: 0.18,
      taxAddedToTotal: true,
      items: [
        {
          sortOrder: 0,
          quantity: 1,
          title: "Camera package",
          unitPrice: 1000,
          taxBehavior: "follows_quote",
        },
      ],
    });

    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        quotes: quoteMutations,
        quoteReads,
        invoices: invoiceMutations,
        assets: noopMutation("assets"),
        packing: noopMutation("packing"),
        projects: noopMutation("projects"),
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        finance: noopMutation("finance"),
        treasury: noopMutation("treasury"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    const updateResult = registry.execute(
      "update_quote_draft",
      JSON.stringify({
        quote_id: created.quoteId,
        client_name: "Metadata Client Updated",
        quote_date: "2026-06-23",
        validity_days: 20,
        currency: "DOP",
        base_currency: "DOP",
        exchange_rate: 1,
        items: [{ title: "Camera package updated", quantity: 2, unit_price: 1200 }],
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["finance.manage"] },
      { allowedToolNames: ["update_quote_draft"] },
    );

    expect(updateResult.result.payload.quoteId).toBe(created.quoteId);
    expect(quoteReads.getQuoteDetail("workspace-metadata", created.quoteId)?.items[0]?.quantity).toBe(2);

    quoteMutations.setStatus({
      commandId: "cmd-agent-finance-quote-sent",
      workspaceId: "workspace-metadata",
      actorType: "agent",
      sourceChannel: "desktop",
      quoteId: created.quoteId,
      status: "sent",
    });
    quoteMutations.setStatus({
      commandId: "cmd-agent-finance-quote-approved",
      workspaceId: "workspace-metadata",
      actorType: "agent",
      sourceChannel: "desktop",
      quoteId: created.quoteId,
      status: "approved",
    });

    expect(() =>
      registry.execute(
        "create_invoice_from_quote",
        JSON.stringify({ quote_id: created.quoteId }),
        { workspaceId: "workspace-metadata", userPermissions: ["finance.manage"] },
        { allowedToolNames: ["create_invoice_from_quote"] },
      ),
    ).toThrow("Blocked. This action requires the invoices.create permission.");

    const invoiceResult = registry.execute(
      "create_invoice_from_quote",
      JSON.stringify({ quote_id: created.quoteId, issue_date: "2026-06-24" }),
      { workspaceId: "workspace-metadata", userPermissions: ["invoices.create"] },
      { allowedToolNames: ["create_invoice_from_quote"] },
    );

    expect(invoiceResult.result.payload.invoiceId).toMatch(/^invoice-/);
    expect(invoiceResult.result.payload.invoiceNumber).toMatch(/^2026-/);

    cleanup();
  });

  it("manages personal todos and reminders for the acting user", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-tasks");
    const secretStore = { hasProviderSecret: () => false };
    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });
    applyNotificationLocalMigration(database);
    const notifications = createNotificationLocalService(database);
    const todo = notifications.createTodo({
      userId: "user-paola",
      workspaceId: "workspace-metadata",
      title: "Confirm return window",
      createdBy: "agent",
    });
    const reminder = notifications.createReminder({
      userId: "user-paola",
      workspaceId: "workspace-metadata",
      title: "Call crew",
      remindAt: "2026-06-24T14:00:00.000Z",
      createdBy: "agent",
    });
    notifications.createTodo({
      userId: "user-carlos",
      workspaceId: "workspace-metadata",
      title: "Private task",
      createdBy: "user",
    });

    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        notifications,
        assets: noopMutation("assets"),
        packing: noopMutation("packing"),
        projects: noopMutation("projects"),
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        finance: noopMutation("finance"),
        quotes: noopMutation("quotes"),
        treasury: noopMutation("treasury"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    expect(() =>
      registry.execute(
        "list_todos",
        "{}",
        { workspaceId: "workspace-metadata" },
        { allowedToolNames: ["list_todos"] },
      ),
    ).toThrow("This personal task action requires an authenticated user.");

    const listResult = registry.execute(
      "list_todos",
      JSON.stringify({ limit: 10 }),
      { workspaceId: "workspace-metadata", sourceActorUserId: "user-paola" },
      { allowedToolNames: ["list_todos"] },
    );

    expect((listResult.result.payload.todos as Array<{ id: string }>).map((row) => row.id)).toEqual([todo.id]);
    expect((listResult.result.payload.reminders as Array<{ id: string }>).map((row) => row.id)).toEqual([reminder.id]);

    registry.execute(
      "complete_todo",
      JSON.stringify({ todo_id: todo.id, completed_at: "2026-06-23T20:00:00.000Z" }),
      { workspaceId: "workspace-metadata", sourceActorUserId: "user-paola" },
      { allowedToolNames: ["complete_todo"] },
    );
    expect(notifications.listTodos({ userId: "user-paola", workspaceId: "workspace-metadata" })[0]?.completedAt).toBe(
      "2026-06-23T20:00:00.000Z",
    );

    registry.execute(
      "update_reminder",
      JSON.stringify({
        reminder_id: reminder.id,
        title: "Call crew updated",
        remind_at: "2026-06-24T15:00:00.000Z",
      }),
      { workspaceId: "workspace-metadata", sourceActorUserId: "user-paola" },
      { allowedToolNames: ["update_reminder"] },
    );
    expect(notifications.listReminders({ userId: "user-paola", workspaceId: "workspace-metadata" })[0]?.title).toBe(
      "Call crew updated",
    );

    registry.execute(
      "cancel_reminder",
      JSON.stringify({ reminder_id: reminder.id }),
      { workspaceId: "workspace-metadata", sourceActorUserId: "user-paola" },
      { allowedToolNames: ["cancel_reminder"] },
    );
    expect(notifications.listReminders({ userId: "user-paola", workspaceId: "workspace-metadata" })).toEqual([]);

    const outboxRows = database
      .prepare("SELECT entity_type, operation_type FROM sync_outbox WHERE entity_id IN (?, ?) ORDER BY entity_type, operation_type")
      .all(todo.id, reminder.id) as Array<{ entity_type: string; operation_type: string }>;
    expect(outboxRows).toEqual(
      expect.arrayContaining([
        { entity_type: "todo", operation_type: "upsert" },
        { entity_type: "reminder", operation_type: "delete" },
      ]),
    );

    cleanup();
  });

  it("executes project unit lifecycle tools through project mutations", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-unit-writes");
    const secretStore = { hasProviderSecret: () => false };
    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        projects: createProjectMutationService(database),
        assets: noopMutation("assets"),
        packing: noopMutation("packing"),
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        finance: noopMutation("finance"),
        quotes: noopMutation("quotes"),
        treasury: noopMutation("treasury"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    expect(() =>
      registry.execute(
        "update_project_unit",
        JSON.stringify({
          project_id: "project-aurora",
          unit_id: "unit-missing",
          code: "AGTU",
          name: "Agent Unit",
          sort_order: 9,
        }),
        { workspaceId: "workspace-metadata", userPermissions: ["projects.read"] },
        { allowedToolNames: ["update_project_unit"] },
      ),
    ).toThrow("Blocked. This action requires the projects.manage permission.");

    registry.execute(
      "create_project_unit",
      JSON.stringify({
        project_id: "project-aurora",
        code: "AGTU",
        name: "Agent Unit",
        sort_order: 9,
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["projects.manage"] },
      { allowedToolNames: ["create_project_unit"] },
    );

    const createdUnit = database
      .prepare("SELECT id FROM project_units WHERE project_id = ? AND code = ? LIMIT 1")
      .get("project-aurora", "AGTU") as { id: string } | undefined;
    expect(createdUnit?.id).toBeTruthy();

    const updateResult = registry.execute(
      "update_project_unit",
      JSON.stringify({
        project_id: "project-aurora",
        unit_id: createdUnit!.id,
        code: "AGTU",
        name: "Agent Unit Updated",
        sort_order: 10,
        notes: "Updated through agent tool coverage.",
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["projects.manage"] },
      { allowedToolNames: ["update_project_unit"] },
    );

    expect(updateResult.result.payload.unitId).toBe(createdUnit!.id);
    const updatedUnit = database
      .prepare("SELECT name, sort_order FROM project_units WHERE id = ? LIMIT 1")
      .get(createdUnit!.id) as { name: string; sort_order: number } | undefined;
    expect(updatedUnit).toEqual({ name: "Agent Unit Updated", sort_order: 10 });

    const deleteResult = registry.execute(
      "delete_project_unit",
      JSON.stringify({ project_id: "project-aurora", unit_id: createdUnit!.id }),
      { workspaceId: "workspace-metadata", userPermissions: ["projects.manage"] },
      { allowedToolNames: ["delete_project_unit"] },
    );

    expect(deleteResult.result.payload.unitId).toBe(createdUnit!.id);
    expect(database.prepare("SELECT id FROM project_units WHERE id = ? LIMIT 1").get(createdUnit!.id)).toBeUndefined();

    const outbox = database
      .prepare("SELECT payload_json FROM sync_outbox WHERE entity_type = 'project' AND entity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get("project-aurora") as { payload_json: string } | undefined;
    expect(outbox?.payload_json).toContain("delete_unit");

    cleanup();
  });

  it("executes asset write tools through the audited asset mutation service", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-asset-writes");
    const secretStore = { hasProviderSecret: () => false };
    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });
    const reads = createFoundationReadService(database);
    const registry = createAgentToolRegistry(reads, {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        assets: createAssetMutationService(database),
        packing: noopMutation("packing"),
        projects: noopMutation("projects"),
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        finance: noopMutation("finance"),
        quotes: noopMutation("quotes"),
        treasury: noopMutation("treasury"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    expect(() =>
      registry.execute(
        "create_asset",
        JSON.stringify({
          name: "Agent managed monitor",
          internal_code: "AGT-MON-01",
          category_id: "cat-lighting",
        }),
        { workspaceId: "workspace-metadata", userPermissions: ["assets.read"] },
        { allowedToolNames: ["create_asset"] },
      ),
    ).toThrow("Blocked. This action requires the assets.manage permission.");

    const createResult = registry.execute(
      "create_asset",
      JSON.stringify({
        name: "Agent managed monitor",
        internal_code: "AGT-MON-01",
        category_id: "cat-lighting",
        default_location_id: "loc-warehouse-a",
        condition_status: "Good",
        total_quantity: 1,
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["assets.manage"] },
      { allowedToolNames: ["create_asset"] },
    );
    const assetId = createResult.result.payload.assetId as string;

    expect(assetId).toMatch(/^asset-/);
    expect(reads.getAssetDetail(assetId).asset?.code).toBe("AGT-MON-01");

    const updateResult = registry.execute(
      "update_asset",
      JSON.stringify({
        asset_id: assetId,
        name: "Agent managed monitor updated",
        internal_code: "AGT-MON-01",
        category_id: "cat-lighting",
        default_location_id: "loc-warehouse-a",
        condition_status: "Review",
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["assets.manage"] },
      { allowedToolNames: ["update_asset"] },
    );

    expect(updateResult.result.payload.assetId).toBe(assetId);
    expect(reads.getAssetDetail(assetId).asset?.condition).toBe("Review");

    const assignResult = registry.execute(
      "assign_move_assets",
      JSON.stringify({
        asset_ids: [assetId],
        mode: "assign",
        project_id: "project-aurora",
        assigned_to_user_id: "user-paola",
      }),
      { workspaceId: "workspace-metadata", userPermissions: ["assets.manage"] },
      { allowedToolNames: ["assign_move_assets"] },
    );

    expect(assignResult.result.payload.processedAssetIds).toEqual([assetId]);
    expect(assignResult.result.payload.eventType).toBe("assigned");

    const event = database
      .prepare("SELECT actor_type, source_channel FROM asset_events WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(assetId) as { actor_type: string; source_channel: string } | undefined;
    expect(event).toEqual({ actor_type: "agent", source_channel: "desktop" });

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id LIKE 'agent-assets-assign-move-%' ORDER BY executed_at DESC LIMIT 1")
      .get() as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    cleanup();
  });

  it("filters tool definitions and blocks execution outside an agent allowlist", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-allowlist");
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => [],
    });

    const allowedDefinitions = registry.definitionsFor(["search_assets"]);

    expect(allowedDefinitions.map((tool) => tool.name)).toEqual(["search_assets"]);
    expect(registry.isAllowed("search_assets", ["search_assets"])).toBe(true);
    expect(registry.isAllowed("get_financial_health", ["search_assets"])).toBe(false);
    expect(() =>
      registry.execute("get_financial_health", "{}", { workspaceId: "workspace-metadata" }, {
        allowedToolNames: ["search_assets"],
      }),
    ).toThrow("Tool get_financial_health is not allowed for this agent.");

    cleanup();
  });

  it("requires user permissions for finance and treasury read tools even when the agent allowlist permits them", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-finance-permissions");
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => [],
    });

    expect(() =>
      registry.execute(
        "get_financial_health",
        "{}",
        { workspaceId: "workspace-metadata" },
        { allowedToolNames: ["get_financial_health"] },
      ),
    ).toThrow("Blocked. This action requires the finance.read permission.");

    expect(() =>
      registry.execute(
        "list_bank_movements",
        "{}",
        { workspaceId: "workspace-metadata", userPermissions: ["finance.read"] },
        { allowedToolNames: ["list_bank_movements"] },
      ),
    ).toThrow("Blocked. This action requires the treasury.transactions.read permission.");

    expect(
      registry.execute(
        "get_financial_health",
        "{}",
        { workspaceId: "workspace-metadata", userPermissions: ["finance.read"] },
        { allowedToolNames: ["get_financial_health"] },
      ).result.payload,
    ).toBeTruthy();

    cleanup();
  });

  it("resolves combined project labels before executing write tools", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-project-label-write");
    const secretStore = { hasProviderSecret: () => false };
    const noopMutation = (label: string) =>
      new Proxy({}, {
        get: () => () => {
          throw new Error(`mutation '${label}' should not be invoked in this test`);
        },
      });
    let createdUnitProjectId: string | null = null;

    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeServices: {
        packing: noopMutation("packing"),
        projects: {
          createProjectUnit(input: { projectId: string }) {
            createdUnitProjectId = input.projectId;
          },
        },
        incidents: noopMutation("incidents"),
        rma: noopMutation("rma"),
        assets: noopMutation("assets"),
        finance: noopMutation("finance"),
        quotes: noopMutation("quotes"),
        projectLookup: {
          findByCode(_workspaceId: string, code: string) {
            return code === "AGT" ? { id: "project-agent-test-shoot", code: "AGT", name: "Agent Test Shoot", status: "Prep" } : null;
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    const result = registry.execute(
      "create_project_unit",
      JSON.stringify({
        project_id: "Agent Test Shoot / AGT",
        code: "MAIN",
        name: "Main Unit",
      }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/projects",
        currentView: "Projects",
        userPermissions: ["*"],
      },
    );

    expect(createdUnitProjectId).toBe("project-agent-test-shoot");
    expect(result.result.payload.projectId).toBe("project-agent-test-shoot");

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
        userPermissions: ["*"],
      },
    );
    const reservations = registry.execute(
      "get_asset_reservations",
      JSON.stringify({ query: "Alexa", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/assets",
        currentView: "Assets",
        userPermissions: ["*"],
      },
    );
    const incidentDetail = registry.execute(
      "get_incident_detail",
      JSON.stringify({ incident_id: "incident-cine7-scratch" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/incidents",
        currentView: "Incidents",
        userPermissions: ["*"],
      },
    );
    const finance = registry.execute(
      "get_project_financials",
      JSON.stringify({ project_id: "project-aurora" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
        userPermissions: ["finance.read"],
      },
    );
    const budgetVsActual = registry.execute(
      "get_budget_vs_actual",
      JSON.stringify({ project_id: "project-aurora" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
        userPermissions: ["finance.read"],
      },
    );
    const burnRate = registry.execute(
      "get_monthly_burn_rate",
      JSON.stringify({ project_id: "project-aurora", months: 4 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
        userPermissions: ["finance.read"],
      },
    );
    const expenseBreakdown = registry.execute(
      "get_expense_breakdown",
      JSON.stringify({ project_id: "project-aurora", period: "quarter" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
        userPermissions: ["finance.read"],
      },
    );
    const financialHealth = registry.execute(
      "get_financial_health",
      JSON.stringify({ project_id: "project-aurora", period: "month" }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/finance",
        currentView: "Finance",
        userPermissions: ["finance.read"],
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
        userPermissions: ["*"],
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
        userPermissions: ["*"],
      },
    );

    expect(workspaceSearch.result.payload.scope).toBe("workspace");
    expect(
      (workspaceSearch.result.payload.items as Array<{ name: string; availableQuantity: number }>).some(
        (item) => item.name.includes("Aputure") && item.availableQuantity > 0,
      ),
    ).toBe(true);
    expect(projectSearch.result.payload.scope).toBe("project");
    expect(projectSearch.result.payload.count).toBe(0);

    cleanup();
  });

  it("returns available workspace alternatives when an exact asset search misses", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-asset-alternatives");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });

    const search = registry.execute(
      "search_assets",
      JSON.stringify({ query: "aputure phantom", status: "Available", limit: 5 }),
      {
        workspaceId: "workspace-metadata",
        activePath: "/assets",
        currentView: "Assets",
        userPermissions: ["*"],
      },
    );

    expect(search.result.payload.exactMatch).toBe(false);
    expect(search.result.payload.fallbackQuery).toBe("aputure phantom");
    expect((search.result.payload.items as Array<{ name: string; availableQuantity: number }>)[0]).toMatchObject({
      name: "Aputure 600D",
      availableQuantity: 1,
    });

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
      userPermissions: ["*"],
    });
    const activeWorkspaceSearch = registry.execute("search_projects", JSON.stringify({ query: "AGT", limit: 5 }), {
      workspaceId: "workspace-cine2-test",
      activePath: "/projects",
      currentView: "Projects",
      userPermissions: ["*"],
    });

    expect(defaultWorkspaceSearch.result.payload.count).toBe(0);
    expect((activeWorkspaceSearch.result.payload.items as Array<{ id: string }>)[0]?.id).toBe("project-agent-test-shoot");

    cleanup();
  });

  it("exposes exchange-rate tools with source proof and best-bank comparison", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agent-tool-registry-exchange-rates");
    const secretStore = {
      hasProviderSecret: () => false,
    };
    const currencyMutations = createCurrencyMutationService(database);
    const currencyReads = createCurrencyReadService(database);

    currencyMutations.createRate({
      commandId: "cmd-agent-rate-popular-buy",
      workspaceId: "workspace-metadata",
      actorType: "integration",
      sourceChannel: "desktop",
      baseCurrency: "USD",
      quoteCurrency: "DOP",
      rate: 58,
      rateType: "buy",
      source: "banco_popular",
      sourceLabel: "Banco Popular",
      effectiveDate: "2026-05-09",
      fetchedAt: new Date().toISOString(),
      notes: "Imported from TasaReal. Source: https://tasareal.com.",
    });
    currencyMutations.createRate({
      commandId: "cmd-agent-rate-central-buy",
      workspaceId: "workspace-metadata",
      actorType: "integration",
      sourceChannel: "desktop",
      baseCurrency: "USD",
      quoteCurrency: "DOP",
      rate: 58.5,
      rateType: "buy",
      source: "banco_central",
      sourceLabel: "Banco Central",
      effectiveDate: "2026-05-09",
      fetchedAt: new Date().toISOString(),
      notes: "Imported from TasaReal. Source: https://tasareal.com.",
    });

    const registry = createAgentToolRegistry(createFoundationReadService(database), {
      currencyReads,
      getRunsList: () => createAgentReadService(database, secretStore).getRunsList(),
    });

    const rates = registry.execute("get_exchange_rates", JSON.stringify({ base_currency: "USD", limit: 5 }), {
      workspaceId: "workspace-metadata",
      activePath: "/finance",
      currentView: "Finance",
    });
    const comparison = registry.execute("compare_exchange_rates", JSON.stringify({ base_currency: "USD", amount: 100 }), {
      workspaceId: "workspace-metadata",
      activePath: "/finance",
      currentView: "Finance",
    });

    expect(rates.result.payload.count).toBe(2);
    expect((rates.result.payload.items as Array<{ sourceProof: string | null }>)[0]?.sourceProof).toBe("https://tasareal.com");
    expect(comparison.result.payload.bestBuySource).toBe("Banco Central");
    expect((comparison.result.payload.items as Array<{ receiveDopIfSellingForeign: number | null }>)[0]?.receiveDopIfSellingForeign).toBeTruthy();

    cleanup();
  });
});
