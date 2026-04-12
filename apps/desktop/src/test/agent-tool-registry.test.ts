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
        "get_incident_costs",
        "get_asset_exposure",
        "get_open_invoices",
        "get_reserves_status",
      ]),
    );

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

    expect((capabilities.result.payload.items as Array<unknown>).length).toBeGreaterThan(0);
    expect((projects.result.payload.items as Array<{ name: string }>)[0]?.name).toContain("Aurora");
    expect((reservations.result.payload.items as Array<unknown>).length).toBeGreaterThanOrEqual(0);
    expect((incidentDetail.result.payload.incident as { title?: string } | null)?.title).toBeTruthy();
    expect((finance.result.payload.project as { name?: string } | null)?.name).toContain("Aurora");

    cleanup();
  });
});
