import { describe, expect, it } from "vitest";
import { createCatalogMutationService } from "../../electron/main/services/data/catalogMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("catalog mutation service", () => {
  it("creates, updates and guards global catalog entities", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-mutation-test");
    const mutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);

    mutations.createEntity({
      entityType: "client",
      name: "HBO",
      contactName: "Ops Desk",
      email: "ops@hbo.test",
      phone: "+1 809 555 2020",
      notes: "Created from catalog test.",
    });

    mutations.createEntity({
      entityType: "category",
      code: "BATT",
      name: "Batteries",
      description: "Battery systems",
    });

    mutations.createEntity({
      entityType: "kit",
      code: "MONKIT",
      name: "Monitor Travel Kit",
      description: "Monitor + wireless pair",
      notes: "Ready for fast dispatch",
      assetIds: ["asset-smallhd-cine7", "asset-smallhd-cine7", "asset-teradek-bolt"],
    });

    let snapshot = reads.getCatalogSnapshot();
    const createdClient = snapshot.clients.find((client) => client.name === "HBO");
    const createdCategory = snapshot.categories.find((category) => category.code === "BATT");
    const createdKit = snapshot.kits.find((kit) => kit.code === "MONKIT");

    expect(createdClient?.contactName).toBe("Ops Desk");
    expect(createdCategory?.name).toBe("Batteries");
    expect(createdKit?.assetCount).toBe(2);
    expect(createdKit?.primaryCodeValue.startsWith("KIT-MONKIT")).toBe(true);

    mutations.updateEntity({
      entityType: "client",
      id: createdClient!.id,
      name: "HBO LatAm",
      contactName: "Operations",
      email: "operations@hbo.test",
      phone: "+1 809 555 3030",
      notes: "Renamed from test.",
    });

    snapshot = reads.getCatalogSnapshot();
    expect(snapshot.clients.find((client) => client.id === createdClient!.id)?.name).toBe("HBO LatAm");

    expect(() =>
      mutations.deleteEntity({
        entityType: "location",
        id: "loc-warehouse-a",
      }),
    ).toThrow("linked operational data");

    const alturaClient = snapshot.clients.find((client) => client.name === "Altura");
    expect(() =>
      mutations.deleteEntity({
        entityType: "client",
        id: alturaClient!.id,
      }),
    ).toThrow("linked operational data");

    mutations.deleteEntity({
      entityType: "category",
      id: createdCategory!.id,
    });

    snapshot = reads.getCatalogSnapshot();
    expect(snapshot.categories.some((category) => category.id === createdCategory!.id)).toBe(false);

    cleanup();
  });
});
