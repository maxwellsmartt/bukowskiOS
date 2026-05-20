import { describe, expect, it } from "vitest";

import { evaluateNcfHealth } from "@features/finance/ncfHealth";

const today = new Date("2026-05-20T12:00:00Z");

describe("evaluateNcfHealth", () => {
  it("requires a series and usable sequence before issuing", () => {
    expect(evaluateNcfHealth({ today }).status).toBe("missing");
    expect(evaluateNcfHealth({ ncfSeriesActive: "B01", ncfSequenceNext: 1, today }).canIssue).toBe(false);
  });

  it("blocks exhausted and expired sequences", () => {
    expect(
      evaluateNcfHealth({
        ncfSeriesActive: "B01",
        ncfSequenceNext: 101,
        ncfSequenceMax: 100,
        today,
      }),
    ).toMatchObject({ status: "exhausted", canIssue: false });

    expect(
      evaluateNcfHealth({
        ncfSeriesActive: "B01",
        ncfSequenceNext: 1,
        ncfSequenceMax: 100,
        ncfExpiresAt: "2026-05-19",
        today,
      }),
    ).toMatchObject({ status: "expired", canIssue: false });
  });

  it("warns but still allows issue when the sequence is low or expiring soon", () => {
    expect(
      evaluateNcfHealth({
        ncfSeriesActive: "B01",
        ncfSequenceNext: 92,
        ncfSequenceMax: 100,
        today,
      }),
    ).toMatchObject({ status: "low", canIssue: true, remaining: 9 });

    expect(
      evaluateNcfHealth({
        ncfSeriesActive: "B01",
        ncfSequenceNext: 1,
        ncfSequenceMax: 100,
        ncfExpiresAt: "2026-06-01",
        today,
      }),
    ).toMatchObject({ status: "expiring", canIssue: true, daysUntilExpiry: 12 });
  });

  it("returns ready for healthy NCF settings", () => {
    expect(
      evaluateNcfHealth({
        ncfSeriesActive: " b01 ",
        ncfSequenceNext: 10,
        ncfSequenceMax: 1000,
        ncfExpiresAt: "2026-12-31",
        today,
      }),
    ).toMatchObject({ status: "ready", tone: "success", canIssue: true, series: "B01" });
  });
});
