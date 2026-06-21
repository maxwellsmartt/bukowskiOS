import { describe, expect, it } from "vitest";

import {
  MAX_ACCEPTED_CLIENT_CLOCK_SKEW_MS,
  isLocalTimestampAtLeastAsNew,
  isLocalTimestampStrictlyNewer,
} from "../../electron/main/services/data/syncTimestampPolicy";

describe("sync timestamp policy", () => {
  const now = Date.parse("2026-06-21T12:00:00.000Z");

  it("keeps normal local LWW comparisons", () => {
    expect(isLocalTimestampAtLeastAsNew(
      "2026-06-21T11:00:00.000Z",
      "2026-06-21T10:00:00.000Z",
      now,
    )).toBe(true);
    expect(isLocalTimestampStrictlyNewer(
      "2026-06-21T11:00:00.000Z",
      "2026-06-21T11:00:00.000Z",
      now,
    )).toBe(false);
  });

  it("does not let a future workstation clock suppress server state", () => {
    const futureLocal = new Date(now + MAX_ACCEPTED_CLIENT_CLOCK_SKEW_MS + 1).toISOString();
    expect(isLocalTimestampAtLeastAsNew(futureLocal, "2026-06-21T12:00:00.000Z", now)).toBe(false);
    expect(isLocalTimestampStrictlyNewer(futureLocal, "2026-06-21T12:00:00.000Z", now)).toBe(false);
  });

  it("fails open toward authoritative remote state for malformed timestamps", () => {
    expect(isLocalTimestampAtLeastAsNew("invalid", "2026-06-21T12:00:00.000Z", now)).toBe(false);
    expect(isLocalTimestampAtLeastAsNew("2026-06-21T12:00:00.000Z", "invalid", now)).toBe(false);
  });
});
