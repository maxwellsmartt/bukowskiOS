import { describe, expect, it } from "vitest";

import { createSoftwareLicenseService } from "../../electron/main/services/data/softwareLicenseService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const workspaceId = "workspace-metadata";

const baseLicense = {
  workspaceId,
  softwareName: "Adobe Creative Cloud",
  status: "active" as const,
  licenseType: "subscription" as const,
  seatCount: 3,
  seatAssignments: ["ivan@metadata.do"],
  reminderDaysBefore: 7,
};

describe("software license service", () => {
  it("creates, lists, updates seats, archives and enqueues sync", () => {
    const { cleanup, database } = createTestDatabase("software-licenses");
    const svc = createSoftwareLicenseService(database);

    const created = svc.upsertLicense(baseLicense);
    expect(created.licenseId).toBeTruthy();

    let list = svc.listLicenses(workspaceId);
    expect(list).toHaveLength(1);
    expect(list[0].software_name).toBe("Adobe Creative Cloud");
    expect(list[0].seat_assignments).toEqual(["ivan@metadata.do"]);

    // Each write enqueues a sync_outbox row so licenses propagate.
    const outbox = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'software_license' AND entity_id = ?`,
      )
      .get(created.licenseId) as { count: number };
    expect(outbox.count).toBeGreaterThan(0);

    // Update via upsert (same id) edits in place.
    svc.upsertLicense({ ...baseLicense, licenseId: created.licenseId, softwareName: "Adobe CC (Team)" });
    expect(svc.listLicenses(workspaceId)).toHaveLength(1);
    expect(svc.listLicenses(workspaceId)[0].software_name).toBe("Adobe CC (Team)");

    svc.setSeats({ workspaceId, licenseId: created.licenseId, seatAssignments: ["ivan@metadata.do", "carlos@metadata.do"] });
    expect(svc.listLicenses(workspaceId)[0].seat_assignments).toHaveLength(2);

    svc.archiveLicense({ workspaceId, licenseId: created.licenseId });
    expect(svc.listLicenses(workspaceId)).toHaveLength(0);

    cleanup();
  });
});
