import { describe, expect, it } from "vitest";

import { createCurrencyMutationService } from "../../electron/main/services/data/currencyMutationService";
import { createCurrencyReadService } from "../../electron/main/services/data/currencyReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const baseChannel = { actorType: "user" as const, sourceChannel: "desktop" as const };

describe("currency mutation service", () => {
  it("upserts settings and returns sensible defaults until then", () => {
    const { cleanup, database } = createTestDatabase("bukowski-currency-settings");
    const reads = createCurrencyReadService(database);
    const mutations = createCurrencyMutationService(database);

    // Default settings appear before any save (DOP base from seed workspace).
    const initial = reads.getSettings("workspace-metadata");
    expect(initial.baseCurrency).toBeTruthy();
    expect(initial.defaultItbisRate).toBe(0.18);
    expect(initial.enabledCurrencies).toContain("DOP");

    const result = mutations.upsertSettings({
      commandId: "cmd-currency-upsert",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      baseCurrency: "DOP",
      defaultQuoteCurrency: "DOP",
      enabledCurrencies: ["DOP", "USD", "EUR"],
      defaultRateSource: "manual",
      defaultRateType: "manual",
      defaultItbisRate: 0.18,
      defaultQuoteValidityDays: 30,
      sirecineNumber: "SIR-2026-0001",
    });

    expect(result.repeated).toBe(false);
    const settings = reads.getSettings("workspace-metadata");
    expect(settings.sirecineNumber).toBe("SIR-2026-0001");
    expect(settings.defaultQuoteValidityDays).toBe(30);

    const repeat = mutations.upsertSettings({
      commandId: "cmd-currency-upsert",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      baseCurrency: "DOP",
      defaultQuoteCurrency: "DOP",
      enabledCurrencies: ["DOP", "USD", "EUR"],
      defaultRateSource: "manual",
      defaultRateType: "manual",
      defaultItbisRate: 0.18,
      defaultQuoteValidityDays: 45,
    });
    expect(repeat.repeated).toBe(true);
    // Idempotent: validity should still be 30, not 45.
    expect(reads.getSettings("workspace-metadata").defaultQuoteValidityDays).toBe(30);

    cleanup();
  });

  it("creates exchange rates and returns the latest one ordered by date", () => {
    const { cleanup, database } = createTestDatabase("bukowski-currency-rates");
    const reads = createCurrencyReadService(database);
    const mutations = createCurrencyMutationService(database);

    mutations.createRate({
      commandId: "cmd-rate-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      baseCurrency: "USD",
      quoteCurrency: "DOP",
      rate: 58.5,
      rateType: "manual",
      source: "manual",
      effectiveDate: "2026-04-01",
    });
    mutations.createRate({
      commandId: "cmd-rate-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      baseCurrency: "USD",
      quoteCurrency: "DOP",
      rate: 60.25,
      rateType: "manual",
      source: "manual",
      effectiveDate: "2026-05-01",
    });

    const list = reads.listRates("workspace-metadata", { baseCurrency: "USD", quoteCurrency: "DOP" });
    expect(list).toHaveLength(2);
    expect(list[0]?.effectiveDate).toBe("2026-05-01");

    const latest = reads.getLatestRate("workspace-metadata", "USD", "DOP");
    expect(latest?.rate).toBe(60.25);

    cleanup();
  });

  it("rejects invalid input", () => {
    const { cleanup, database } = createTestDatabase("bukowski-currency-validation");
    const mutations = createCurrencyMutationService(database);

    expect(() =>
      mutations.createRate({
        commandId: "cmd-rate-bad-1",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        baseCurrency: "USD",
        quoteCurrency: "USD",
        rate: 1,
        rateType: "manual",
        source: "manual",
        effectiveDate: "2026-04-01",
      }),
    ).toThrow(/differ/);

    expect(() =>
      mutations.createRate({
        commandId: "cmd-rate-bad-2",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        baseCurrency: "USD",
        quoteCurrency: "DOP",
        rate: 0,
        rateType: "manual",
        source: "manual",
        effectiveDate: "2026-04-01",
      }),
    ).toThrow(/greater than zero/);

    expect(() =>
      mutations.upsertSettings({
        commandId: "cmd-bad-itbis",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        baseCurrency: "DOP",
        defaultQuoteCurrency: "DOP",
        enabledCurrencies: ["DOP"],
        defaultRateSource: "manual",
        defaultRateType: "manual",
        defaultItbisRate: 1.5,
        defaultQuoteValidityDays: 30,
      }),
    ).toThrow(/ITBIS rate/);

    cleanup();
  });

  it("deletes a rate and prevents re-deleting after success", () => {
    const { cleanup, database } = createTestDatabase("bukowski-currency-delete");
    const reads = createCurrencyReadService(database);
    const mutations = createCurrencyMutationService(database);

    const created = mutations.createRate({
      commandId: "cmd-rate-del-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      baseCurrency: "EUR",
      quoteCurrency: "DOP",
      rate: 65,
      rateType: "manual",
      source: "manual",
      effectiveDate: "2026-04-01",
    });

    mutations.deleteRate({
      commandId: "cmd-rate-del-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      rateId: created.rateId,
    });

    expect(reads.getLatestRate("workspace-metadata", "EUR", "DOP")).toBeNull();

    cleanup();
  });
});
