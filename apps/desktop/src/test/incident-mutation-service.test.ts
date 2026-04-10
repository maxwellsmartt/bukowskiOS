import { describe, expect, it } from "vitest";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createIncidentMutationService } from "../../electron/main/services/data/incidentMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("incident mutation service", () => {
  it("creates incidents from asset context and project-only context with audit linkage", () => {
    const { cleanup, database } = createTestDatabase("bukowski-incident-mutation-test");
    const reads = createFoundationReadService(database);
    const mutations = createIncidentMutationService(database);

    const assetResult = mutations.reportIncident({
      commandId: "cmd-test-incident-asset",
      workspaceId: "workspace-metadata",
      assetId: "asset-smallhd-cine7",
      incidentType: "damage",
      severity: "Medium",
      title: "Monitor cable strain",
      description: "Cable mount is pulling against the cage during handheld setup.",
      costEstimate: 75,
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(assetResult.repeated).toBe(false);

    const assetDetail = reads.getAssetDetail("asset-smallhd-cine7");
    expect(assetDetail.timeline[0]?.title).toBe("Incident reported");
    expect(assetDetail.linkedIncidents.some((incident) => incident.title === "Monitor cable strain")).toBe(true);

    const incidents = reads.getIncidents();
    expect(incidents.some((incident) => incident.title === "Monitor cable strain" && incident.project === "Aurora Campaign")).toBe(true);

    const financeLinks = reads.getFinanceCostLinks();
    expect(financeLinks.some((row) => row.incident === "Monitor cable strain" && row.costEstimate === "$75")).toBe(true);

    const projectOnlyResult = mutations.reportIncident({
      commandId: "cmd-test-incident-project",
      workspaceId: "workspace-metadata",
      projectId: "project-archipielago",
      incidentType: "other",
      severity: "Low",
      title: "Prep labels missing",
      description: "Project cases need fresh prep labels before dispatch.",
      notes: "No asset linked yet.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(projectOnlyResult.repeated).toBe(false);
    expect(reads.getProjectDetail("project-archipielago").incidents.some((incident) => incident.title === "Prep labels missing")).toBe(true);

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-incident-asset") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    const outboxCount = database
      .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'incident'")
      .get() as { count: number };
    expect(outboxCount.count).toBeGreaterThanOrEqual(2);

    cleanup();
  });
});
