import { describe, expect, it } from "vitest";

import {
  applyCompositePullCursor,
  canAdvanceCompositePullCursor,
  cursorFromRow,
} from "@shared/lib/compositePullCursor";

describe("composite pull cursor", () => {
  it("keeps paging rows that share the same timestamp", () => {
    const calls: Array<[string, string]> = [];
    const query = {
      gte(column: string, value: string) {
        calls.push(["gte", `${column}:${value}`]);
        return this;
      },
      or(filter: string) {
        calls.push(["or", filter]);
        return this;
      },
    };

    applyCompositePullCursor(
      query,
      { timestamp: "2026-06-19T12:00:00.000Z", id: "row-200" },
      "updated_at",
      "id",
    );

    expect(calls).toEqual([
      [
        "or",
        "updated_at.gt.2026-06-19T12:00:00.000Z,and(updated_at.eq.2026-06-19T12:00:00.000Z,id.gt.row-200)",
      ],
    ]);
  });

  it("builds a stable cursor from the last row in a page", () => {
    expect(cursorFromRow({ updated_at: "2026-06-19T12:00:00.000Z", id: "row-250" }, "updated_at", "id")).toEqual({
      timestamp: "2026-06-19T12:00:00.000Z",
      id: "row-250",
    });
  });

  it("advances after a fully consumed apply", () => {
    expect(
      canAdvanceCompositePullCursor({
        errors: [],
        skippedDueToOutboxCount: 0,
        skippedDueToDependencyCount: 0,
        missingAssetCount: 0,
      }),
    ).toBe(true);
  });

  it("allows older-only skips because the rows are already consumed", () => {
    expect(
      canAdvanceCompositePullCursor({
        errors: [],
        skippedDueToOutboxCount: 0,
        skippedDueToDependencyCount: 0,
        missingAssetCount: 0,
        skippedDueToOlderCount: 2,
      }),
    ).toBe(true);
  });

  it.each([
    ["apply errors", { errors: ["failed"] }],
    ["outbox deferrals", { errors: [], skippedDueToOutboxCount: 1 }],
    ["dependency deferrals", { errors: [], skippedDueToDependencyCount: 1 }],
    ["missing assets", { errors: [], missingAssetCount: 1 }],
  ])("blocks cursor advancement for %s", (_label, result) => {
    expect(canAdvanceCompositePullCursor(result)).toBe(false);
  });
});
