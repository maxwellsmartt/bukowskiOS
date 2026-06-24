import { describe, expect, it } from "vitest";

import { updateProjectSchema } from "@contracts";

describe("updateProjectSchema", () => {
  it("accepts cascadeDates so a date-window save is not rejected by the strict schema", () => {
    const result = updateProjectSchema.safeParse({
      projectId: "project-1",
      code: "PTR",
      name: "Porto Rico",
      status: "paused",
      startDate: "2026-07-13",
      endDate: "2026-10-13",
      hasPreproduction: true,
      preproductionStartDate: "2026-07-06",
      preproductionEndDate: "2026-07-12",
      colorKey: "slate",
      cascadeDates: true,
    });

    expect(result.success).toBe(true);
  });

  it("still rejects genuinely unknown keys", () => {
    const result = updateProjectSchema.safeParse({
      projectId: "project-1",
      code: "PTR",
      name: "Porto Rico",
      somethingBogus: 1,
    });

    expect(result.success).toBe(false);
  });
});
