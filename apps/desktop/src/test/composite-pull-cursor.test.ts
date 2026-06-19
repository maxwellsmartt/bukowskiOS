import { describe, expect, it } from "vitest";

import { applyCompositePullCursor, cursorFromRow } from "@shared/lib/compositePullCursor";

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
});
