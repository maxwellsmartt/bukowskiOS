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
      workspaceId: "workspace-metadata",
      entityType: "client",
      name: "HBO",
      contactName: "Ops Desk",
      email: "ops@hbo.test",
      phone: "+1 809 555 2020",
      notes: "Created from catalog test.",
    });

    mutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "category",
      code: "BATT",
      name: "Batteries",
      description: "Battery systems",
    });

    mutations.createEntity({
      workspaceId: "workspace-metadata",
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
      workspaceId: "workspace-metadata",
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
      workspaceId: "workspace-metadata",
        entityType: "location",
        id: "loc-warehouse-a",
      }),
    ).toThrow("linked operational data");

    const alturaClient = snapshot.clients.find((client) => client.name === "Altura");
    expect(() =>
      mutations.deleteEntity({
      workspaceId: "workspace-metadata",
        entityType: "client",
        id: alturaClient!.id,
      }),
    ).toThrow("linked operational data");

    mutations.deleteEntity({
      workspaceId: "workspace-metadata",
      entityType: "category",
      id: createdCategory!.id,
    });

    snapshot = reads.getCatalogSnapshot();
    expect(snapshot.categories.some((category) => category.id === createdCategory!.id)).toBe(false);

    cleanup();
  });

  it("exports template csv and imports catalog rows with merge and replace", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-csv-test");
    const mutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);

    const template = mutations.buildCsvExport({
      workspaceId: "workspace-metadata",
      entityType: "department",
      mode: "template",
    });

    expect(template.csvText.trim()).toBe("code,name,description,isActive");

    const kitTemplate = mutations.buildCsvExport({
      workspaceId: "workspace-metadata",
      entityType: "kit",
      mode: "template",
    });

    expect(kitTemplate.csvText.trim()).toBe("code,name,description,notes,assetQuantities,isActive");

    mutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "department",
      code: "ZZCSV1",
      name: "Operations",
      description: "Original ops team",
    });

    const mergeCsv = [
      "code,name,description,isActive",
      "ZZCSV1,Operations Updated,Updated ops team,true",
      "ZZCSV2,Digital Imaging,Data cart,false",
    ].join("\n");

    const mergePreview = mutations.previewCsvImport({
      workspaceId: "workspace-metadata",
      entityType: "department",
      csvText: mergeCsv,
      strategy: "merge",
    });

    expect(mergePreview.created).toBe(1);
    expect(mergePreview.updated).toBe(1);
    expect(mergePreview.invalid).toBe(0);

    const mergeResult = mutations.importCsv({
      workspaceId: "workspace-metadata",
      entityType: "department",
      csvText: mergeCsv,
      strategy: "merge",
    });

    expect(mergeResult.created).toBe(1);
    expect(mergeResult.updated).toBe(1);

    let snapshot = reads.getCatalogSnapshot();
    expect(snapshot.departments.find((row) => row.code === "ZZCSV1")?.name).toBe("Operations Updated");
    expect(snapshot.departments.find((row) => row.code === "ZZCSV2")?.isActive).toBe(false);

    const replaceCsv = [
      "code,name,description,isActive",
      "ZZCSV2,Digital Imaging,Data cart,true",
    ].join("\n");

    const replaceResult = mutations.importCsv({
      workspaceId: "workspace-metadata",
      entityType: "department",
      csvText: replaceCsv,
      strategy: "replace",
    });

    expect(replaceResult.updated).toBe(1);
    expect(replaceResult.deactivated).toBeGreaterThanOrEqual(1);

    snapshot = reads.getCatalogSnapshot();
    expect(snapshot.departments.find((row) => row.code === "ZZCSV2")?.isActive).toBe(true);
    expect(snapshot.departments.find((row) => row.code === "ZZCSV1")?.isActive).toBe(false);

    cleanup();
  });

  it("updates crew members using fullName and persists bank accounts", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-crew-test");
    const mutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);

    mutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "crew",
      fullName: "Ana Perez",
      primaryDepartmentId: "dept-camera",
      documentId: "001-0000000-1",
      roleLabel: "DIT",
      email: "ana@test.dev",
      phone: "+1 809 555 1111",
      notes: "Initial crew record",
      bankAccounts: [
        {
          bankName: "Banco Uno",
          accountHolder: "Ana Perez",
          accountNumber: "1234567890",
          accountType: "Checking",
          maskInPreview: true,
        },
      ],
    });

    let snapshot = reads.getCatalogSnapshot();
    const crew = snapshot.crewMembers.find((row) => row.fullName === "Ana Perez");

    expect(crew?.bankAccounts).toHaveLength(1);
    expect(crew?.bankAccounts[0]?.maskedAccountNumber.endsWith("7890")).toBe(true);
    expect(crew?.primaryDepartmentId).toBe("dept-camera");
    expect(crew?.documentId).toBe("001-0000000-1");

    mutations.updateEntity({
      workspaceId: "workspace-metadata",
      entityType: "crew",
      id: crew!.id,
      fullName: "Ana Perez Updated",
      primaryDepartmentId: "dept-camera",
      documentId: "001-0000000-1",
      roleLabel: "Data Manager",
      email: "ana-updated@test.dev",
      phone: "+1 809 555 2222",
      notes: "Updated crew record",
      bankAccounts: [
        {
          bankName: "Banco Dos",
          accountHolder: "Ana Perez Updated",
          accountNumber: "9988776655",
          accountType: "Savings",
          maskInPreview: false,
        },
      ],
    });

    snapshot = reads.getCatalogSnapshot();
    const updatedCrew = snapshot.crewMembers.find((row) => row.id === crew!.id);

    expect(updatedCrew?.fullName).toBe("Ana Perez Updated");
    expect(updatedCrew?.roleLabel).toBe("Data Manager");
    expect(updatedCrew?.bankAccounts).toHaveLength(1);
    expect(updatedCrew?.bankAccounts[0]?.bankName).toBe("Banco Dos");
    expect(updatedCrew?.bankAccounts[0]?.maskInPreview).toBe(false);

    const exportPayload = mutations.buildCsvExport({
      workspaceId: "workspace-metadata",
      entityType: "crew",
      mode: "data",
      ids: [crew!.id],
    });

    expect(exportPayload.csvText).toContain("primaryDepartmentCode");
    expect(exportPayload.csvText).toContain("documentId");
    expect(exportPayload.csvText).toContain("bankAccounts");
    expect(exportPayload.csvText).toContain("CAM");
    expect(exportPayload.csvText).toContain("001-0000000-1");
    expect(exportPayload.csvText).toContain("Banco Dos");

    const importCsv = [
      "fullName,primaryDepartmentCode,documentId,roleLabel,email,phone,notes,bankAccounts,isActive",
      `"Ana CSV",CAM,"402-1234567-8","Loader","ana.csv@test.dev","+1 809 555 3333","CSV import","[{""bankName"":""Banco Tres"",""accountHolder"":""Ana CSV"",""accountNumber"":""1122334455"",""accountType"":""Checking"",""routingNumber"":""021000021"",""notes"":""Primary payout"",""maskInPreview"":true}]",true`,
    ].join("\n");

    const preview = mutations.previewCsvImport({
      workspaceId: "workspace-metadata",
      entityType: "crew",
      csvText: importCsv,
      strategy: "merge",
    });

    expect(preview.created).toBe(1);
    expect(preview.invalid).toBe(0);

    const importResult = mutations.importCsv({
      workspaceId: "workspace-metadata",
      entityType: "crew",
      csvText: importCsv,
      strategy: "merge",
    });

    expect(importResult.created).toBe(1);

    snapshot = reads.getCatalogSnapshot();
    const importedCrew = snapshot.crewMembers.find((row) => row.fullName === "Ana CSV");
    expect(importedCrew?.primaryDepartmentId).toBe("dept-camera");
    expect(importedCrew?.documentId).toBe("402-1234567-8");
    expect(importedCrew?.bankAccounts).toHaveLength(1);
    expect(importedCrew?.bankAccounts[0]?.bankName).toBe("Banco Tres");

    cleanup();
  });

  it("persists kit item quantities and exports them for csv round-trip", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-kit-quantity-test");
    const mutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);

    mutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "kit",
      code: "DITBULK",
      name: "DIT Bulk Kit",
      notes: "Quantity-aware kit",
      assetSelections: [
        { assetId: "asset-legacy-rentman-1", quantity: 2 },
        { assetId: "asset-teradek-bolt", quantity: 1 },
      ],
    });

    const snapshot = reads.getCatalogSnapshot();
    const createdKit = snapshot.kits.find((kit) => kit.code === "DITBULK");

    expect(createdKit?.assetCount).toBe(3);
    expect(createdKit?.assetSelections).toEqual(
      expect.arrayContaining([
        { assetId: "asset-legacy-rentman-1", quantity: 2 },
        { assetId: "asset-teradek-bolt", quantity: 1 },
      ]),
    );

    const csvExport = mutations.buildCsvExport({
      workspaceId: "workspace-metadata",
      entityType: "kit",
      mode: "data",
      ids: [createdKit!.id],
    });

    expect(csvExport.csvText).toContain("assetQuantities");
    expect(csvExport.csvText).toContain("485:2");

    cleanup();
  });
});
