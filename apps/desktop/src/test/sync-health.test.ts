import { describe, expect, it } from "vitest";

import { isSyncCursorStale, parseSyncTimestamp } from "@shared/lib/syncHealth";

describe("sync health", () => {
  it("treats SQLite timestamps as UTC", () => {
    expect(parseSyncTimestamp("2026-06-21 20:00:00")).toBe(Date.parse("2026-06-21T20:00:00Z"));
  });

  it("marks cursors stale only after the freshness window", () => {
    const now = Date.parse("2026-06-21T20:04:00Z");
    expect(isSyncCursorStale({ updatedAt: "2026-06-21T20:02:00Z" }, now)).toBe(false);
    expect(isSyncCursorStale({ updatedAt: "2026-06-21T20:00:00Z" }, now)).toBe(true);
  });
});
