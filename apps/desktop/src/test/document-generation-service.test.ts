import { expect, test } from "vitest";

import { createDocumentGenerationService } from "../../electron/main/services/data/documentGenerationService";

test("document generation service creates a packing slip pdf buffer", async () => {
  const service = createDocumentGenerationService();

  const result = await service.createPackingSlipPdf({
    slipNumber: "PS-2026-0412",
    projectName: "Aurora Campaign",
    departmentName: "Production",
    responsibleName: "Ana Guerrero",
    preparedByName: "Ops Desk",
    issueDate: "2026-04-12",
    dueDate: "2026-04-14",
    status: "Issued",
    notes: "Confirm camera bodies before transport.",
    primaryCodeValue: "packing-slip-0412",
    summary: {
      itemCount: 2,
      returnedCount: 1,
      pendingCount: 1,
    },
    items: [
      {
        code: "CAM-001",
        name: "Cinema Camera",
        quantity: 1,
        conditionOut: "Good",
        conditionIn: "Good",
        location: "Warehouse A",
        responsible: "Ana Guerrero",
        status: "Returned",
      },
      {
        code: "LGT-101",
        name: "Key Light",
        quantity: 2,
        conditionOut: "Good",
        conditionIn: "",
        location: "Truck 3",
        responsible: "Carlos Pena",
        status: "Out",
      },
    ],
  });

  expect(result.fileName).toBe("PS-2026-0412.pdf");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.buffer.length).toBeGreaterThan(1000);
  expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
});
