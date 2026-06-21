import { describe, expect, it, vi } from "vitest";

import {
  catalogDependenciesFromOperationalSnapshots,
  hydrateCatalogDependencies,
} from "../shared/lib/catalogDependencyHydration";

describe("catalog dependency hydration", () => {
  it("extracts and deduplicates project catalog references", () => {
    const dependencies = catalogDependenciesFromOperationalSnapshots([{
      snapshot_json: {
        project: { client_id: "client-1", production_company_id: "company-1" },
        projectDepartments: [{ department_id: "department-1" }],
        unitDepartments: [{ department_id: "department-1" }, { department_id: "department-2" }],
      },
    }]);

    expect(Array.from(dependencies.clients ?? [])).toEqual(["client-1"]);
    expect(Array.from(dependencies.production_companies ?? [])).toEqual(["company-1"]);
    expect(Array.from(dependencies.departments ?? [])).toEqual([
      "department-1",
      "department-1",
      "department-2",
    ]);
  });

  it("queries exact ids and applies their rows before snapshots", async () => {
    const inQuery = vi.fn().mockResolvedValue({
      data: [{
        id: "department-remote",
        workspace_id: "workspace-1",
        code: "VTR",
        name: "Video",
        updated_at: "2026-06-21T20:00:00.000Z",
      }],
      error: null,
    });
    const remote = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: inQuery })),
        })),
      })),
    };
    const applyRemoteCatalogRows = vi.fn().mockResolvedValue({ errors: [] });

    const result = await hydrateCatalogDependencies({
      remote,
      appApi: { applyRemoteCatalogRows },
      workspaceId: "workspace-1",
      dependencies: { departments: ["department-remote", "department-remote", null] },
    });

    expect(inQuery).toHaveBeenCalledWith("id", ["department-remote"]);
    expect(applyRemoteCatalogRows).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "departments",
      workspaceId: "workspace-1",
    }));
    expect(result).toEqual({ hydratedCount: 1, errors: [] });
  });
});
