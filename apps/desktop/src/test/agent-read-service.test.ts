import { describe, expect, it } from "vitest";

import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("agent read service", () => {
  it("hydrates mission control, runs, models and connectors from the local database", () => {
    const { cleanup, database } = createTestDatabase("bukowski-agents-test");
    const reads = createAgentReadService(database);
    const missionControl = reads.getMissionControlSnapshot();

    expect(missionControl.supervisor?.displayName).toBe("Supervisor Agent");
    expect(missionControl.subagents.length).toBeGreaterThanOrEqual(5);
    expect(missionControl.queue.length).toBeGreaterThan(0);
    expect(missionControl.activity.length).toBeGreaterThan(0);
    expect(reads.getAgentsList().some((agent) => agent.displayName === "Assets Agent")).toBe(true);
    expect(reads.getRunsList().some((run) => run.status === "needs_approval")).toBe(true);
    expect(reads.getModelsSnapshot().providers.some((provider) => provider.providerKey === "openai")).toBe(true);
    expect(reads.getConnectorsSnapshot().some((connector) => connector.status === "configured")).toBe(true);

    cleanup();
  });
});
