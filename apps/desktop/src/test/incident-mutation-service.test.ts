import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createIncidentMutationService } from "../../electron/main/services/data/incidentMutationService";
import { createPackingMutationService } from "../../electron/main/services/data/packingMutationService";
import { createUserAdminService } from "../../electron/main/services/data/userAdminService";
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

  it("updates and resolves incidents while keeping receipts and read models in sync", () => {
    const { cleanup, database } = createTestDatabase("bukowski-incident-lifecycle-test");
    const reads = createFoundationReadService(database);
    const mutations = createIncidentMutationService(database);

    const created = mutations.reportIncident({
      commandId: "cmd-test-incident-lifecycle-create",
      workspaceId: "workspace-metadata",
      assetId: "asset-smallhd-cine7",
      incidentType: "malfunction",
      severity: "High",
      title: "Monitor input failure",
      description: "The SDI input drops signal during movement.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    const updated = mutations.updateIncident({
      commandId: "cmd-test-incident-lifecycle-update",
      workspaceId: "workspace-metadata",
      incidentId: created.incidentId,
      status: "In review",
      severity: "Medium",
      responsibleUserId: "user-paola",
      costEstimate: 185,
      financialStatus: "Estimate linked",
      notes: "Bench review scheduled for tomorrow.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(updated.repeated).toBe(false);
    expect(updated.summary).toContain("updated");

    let incident = reads.getIncidentDetail(created.incidentId).incident;
    expect(incident?.status).toBe("In review");
    expect(incident?.severity).toBe("Medium");
    expect(incident?.responsible).toBe("Paola Rivas");
    expect(incident?.costEstimate).toBe("$185");

    const resolved = mutations.resolveIncident({
      commandId: "cmd-test-incident-lifecycle-resolve",
      workspaceId: "workspace-metadata",
      incidentId: created.incidentId,
      resolutionNotes: "Replaced the faulty SDI plate and validated on set.",
      costEstimate: 210,
      financialStatus: "Resolved",
      resolvedByUserId: "user-paola",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(resolved.repeated).toBe(false);
    expect(resolved.summary).toContain("resolved");

    incident = reads.getIncidentDetail(created.incidentId).incident;
    expect(incident?.status).toBe("Resolved");
    expect(incident?.resolvedAt).not.toBeNull();
    expect(incident?.notes).toContain("Replaced the faulty SDI plate");

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-incident-lifecycle-resolve") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    cleanup();
  });

  it("can retire an asset from incident resolution while keeping history visible", () => {
    const { cleanup, database } = createTestDatabase("bukowski-incident-retire-asset-test");
    const reads = createFoundationReadService(database);
    const incidentMutations = createIncidentMutationService(database);
    const assetMutations = createAssetMutationService(database);
    const packingMutations = createPackingMutationService(database);

    const created = incidentMutations.reportIncident({
      commandId: "cmd-test-incident-retire-create",
      workspaceId: "workspace-metadata",
      assetId: "asset-smallhd-cine7",
      incidentType: "damage",
      severity: "High",
      title: "Monitor cracked beyond repair",
      description: "Panel and board are damaged beyond economical repair.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    const resolved = incidentMutations.resolveIncident({
      commandId: "cmd-test-incident-retire-resolve",
      workspaceId: "workspace-metadata",
      incidentId: created.incidentId,
      resolutionNotes: "Vendor confirmed this monitor cannot be repaired.",
      retireAsset: true,
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(resolved.summary).toContain("retired");

    const assetDetail = reads.getAssetDetail("asset-smallhd-cine7");
    expect(assetDetail.asset?.status).toBe("Retired");
    expect(assetDetail.asset?.condition).toBe("No repair");
    expect(assetDetail.asset?.quantity).toBe(0);
    expect(assetDetail.timeline[0]?.title).toBe("Retired from inventory");
    expect(assetDetail.linkedIncidents.some((incident) => incident.title === "Monitor cracked beyond repair")).toBe(true);

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-incident-retire-assign",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-smallhd-cine7"],
        mode: "assign",
        projectId: "project-archipielago",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("retired");

    expect(() =>
      packingMutations.createPackingSlip({
        commandId: "cmd-test-incident-retire-pack",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-smallhd-cine7"],
        projectId: "project-archipielago",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("retired");

    cleanup();
  });

  it("blocks incident reporting when the actor lacks incident permissions", () => {
    const { cleanup, database } = createTestDatabase("bukowski-incident-permission-test");
    const mutations = createIncidentMutationService(database);
    const userAdmin = createUserAdminService(database);

    const financeUser = userAdmin.createUser({
      workspaceId: "workspace-metadata",
      fullName: "Finance Only",
      roleId: "role-finance-viewer",
      email: "finance.only@metadata.cine",
    });

    expect(() =>
      mutations.reportIncident({
        commandId: "cmd-test-incident-blocked",
        workspaceId: "workspace-metadata",
        actorUserId: financeUser.userId ?? "",
        assetId: "asset-smallhd-cine7",
        incidentType: "damage",
        severity: "High",
        title: "Blocked incident",
        description: "This should not pass for a finance-only user.",
        actorType: "user",
        sourceChannel: "telegram",
      }),
    ).toThrow("does not have permission");

    cleanup();
  });
});
