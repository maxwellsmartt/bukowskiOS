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
        // A crew assignment can reference a department outside the matrices — it
        // must still be hydrated, otherwise the assignment loses its department.
        crewAssignments: [{ department_id: "department-3" }],
      },
    }]);

    expect(Array.from(dependencies.clients ?? [])).toEqual(["client-1"]);
    expect(Array.from(dependencies.production_companies ?? [])).toEqual(["company-1"]);
    expect(Array.from(dependencies.departments ?? [])).toEqual([
      "department-1",
      "department-1",
      "department-2",
      "department-3",
    ]);
  });

  it("queries exact ids and applies their rows before snapshots", async () => {
    const departmentId = "7bc31963-1c1b-4df3-ad6b-31b67003d84d";
    const inQuery = vi.fn().mockResolvedValue({
      data: [{
        id: departmentId,
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
      dependencies: { departments: [departmentId, departmentId, null] },
    });

    expect(inQuery).toHaveBeenCalledWith("id", [departmentId]);
    expect(applyRemoteCatalogRows).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "departments",
      workspaceId: "workspace-1",
    }));
    expect(result).toEqual({ hydratedCount: 1, errors: [] });
  });

  it("does not query uuid-backed remote tables with local text ids", async () => {
    const inQuery = vi.fn().mockResolvedValue({ data: [], error: null });
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
      dependencies: {
        asset_categories: [
          "category-rig-mohfn3az",
          "bfb82b33-67a1-4b30-8c55-6b08180653dd",
        ],
      },
    });

    expect(inQuery).toHaveBeenCalledTimes(1);
    expect(inQuery).toHaveBeenCalledWith("id", ["bfb82b33-67a1-4b30-8c55-6b08180653dd"]);
    expect(result).toEqual({ hydratedCount: 0, errors: [] });
  });
});
