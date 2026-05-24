import { describe, expect, it } from "vitest";

import { createCollaboratorFeeMutationService } from "../../electron/main/services/data/collaboratorFeeMutationService";
import { createCollaboratorFeeReadService } from "../../electron/main/services/data/collaboratorFeeReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("collaborator fee service", () => {
  it("creates, suggests, approves and pays collaborator fees idempotently", () => {
    const { cleanup, database } = createTestDatabase("bukowski-collaborator-fees");
    const reads = createCollaboratorFeeReadService(database);
    const mutations = createCollaboratorFeeMutationService(database);

    const suggestions = reads.suggestFromAssignments({ workspaceId: "workspace-metadata", projectId: "project-aurora" });
    expect(suggestions.some((row) => row.sourceAssignmentId === "unit-aurora-main-crew-paola")).toBe(true);

    const created = mutations.createFee({
      commandId: "cmd-crew-fee-create",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-paola",
      projectId: "project-aurora",
      projectUnitId: "unit-aurora-main",
      departmentId: null,
      sourceAssignmentId: "unit-aurora-main-crew-paola",
      feeType: "Camera lead",
      description: "Aurora main unit camera lead fee",
      agreedAmount: 12000,
      currency: "DOP",
      expectedPaymentDate: "2026-04-18",
      notes: "Pay after wrap.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(created.feeId).toBe("crewfee-cmd-crew-fee-create");
    expect(mutations.createFee({
      commandId: "cmd-crew-fee-create",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-paola",
      feeType: "Camera lead",
      agreedAmount: 12000,
      currency: "DOP",
      actorType: "user",
      sourceChannel: "desktop",
    }).repeated).toBe(true);

    expect(reads.suggestFromAssignments({ workspaceId: "workspace-metadata", projectId: "project-aurora" }).some((row) => row.sourceAssignmentId === "unit-aurora-main-crew-paola")).toBe(false);

    mutations.approveFee({
      commandId: "cmd-crew-fee-approve",
      workspaceId: "workspace-metadata",
      feeId: created.feeId!,
      actorType: "user",
      sourceChannel: "desktop",
    });

    let fee = reads.getFeeDetail("workspace-metadata", created.feeId!);
    expect(fee?.status).toBe("approved");

    mutations.recordPayment({
      commandId: "cmd-crew-payment-partial",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-paola",
      paidAt: "2026-04-20",
      currency: "DOP",
      paymentMethod: "Transfer",
      reference: "TRX-001",
      allocations: [{ feeId: created.feeId!, amount: 5000 }],
      actorType: "user",
      sourceChannel: "desktop",
    });

    fee = reads.getFeeDetail("workspace-metadata", created.feeId!);
    expect(fee?.status).toBe("partially_paid");
    expect(fee?.paidAmount).toBe(5000);
    expect(fee?.outstandingAmount).toBe(7000);
    expect(fee?.payments).toHaveLength(1);

    mutations.recordPayment({
      commandId: "cmd-crew-payment-final",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-paola",
      paidAt: "2026-04-22",
      currency: "DOP",
      allocations: [{ feeId: created.feeId!, amount: 7000 }],
      actorType: "user",
      sourceChannel: "desktop",
    });

    fee = reads.getFeeDetail("workspace-metadata", created.feeId!);
    expect(fee?.status).toBe("paid");
    expect(fee?.outstandingAmount).toBe(0);

    const outbox = database
      .prepare("SELECT entity_type FROM sync_outbox WHERE entity_id = ? LIMIT 1")
      .get("crewpay-cmd-crew-payment-final") as { entity_type: string } | undefined;
    expect(outbox?.entity_type).toBe("collaborator_payment");

    cleanup();
  });

  it("rejects unsafe collaborator payment batches", () => {
    const { cleanup, database } = createTestDatabase("bukowski-collaborator-fees-guards");
    const mutations = createCollaboratorFeeMutationService(database);

    const paola = mutations.createFee({
      commandId: "cmd-paola-fee",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-paola",
      feeType: "Prep",
      agreedAmount: 1000,
      currency: "DOP",
      actorType: "user",
      sourceChannel: "desktop",
    });
    const luis = mutations.createFee({
      commandId: "cmd-luis-fee",
      workspaceId: "workspace-metadata",
      crewMemberId: "crew-user-luis",
      feeType: "Assist",
      agreedAmount: 1000,
      currency: "DOP",
      actorType: "user",
      sourceChannel: "desktop",
    });

    mutations.approveFee({ commandId: "cmd-paola-approve", workspaceId: "workspace-metadata", feeId: paola.feeId!, actorType: "user", sourceChannel: "desktop" });
    mutations.approveFee({ commandId: "cmd-luis-approve", workspaceId: "workspace-metadata", feeId: luis.feeId!, actorType: "user", sourceChannel: "desktop" });

    expect(() =>
      mutations.recordPayment({
        commandId: "cmd-cross-crew-payment",
        workspaceId: "workspace-metadata",
        crewMemberId: "crew-user-paola",
        paidAt: "2026-04-22",
        currency: "DOP",
        allocations: [
          { feeId: paola.feeId!, amount: 500 },
          { feeId: luis.feeId!, amount: 500 },
        ],
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow(/selected collaborator/i);

    expect(() =>
      mutations.recordPayment({
        commandId: "cmd-overpay",
        workspaceId: "workspace-metadata",
        crewMemberId: "crew-user-paola",
        paidAt: "2026-04-22",
        currency: "DOP",
        allocations: [{ feeId: paola.feeId!, amount: 2000 }],
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow(/outstanding/i);

    expect(() =>
      mutations.recordPayment({
        commandId: "cmd-duplicate-allocation",
        workspaceId: "workspace-metadata",
        crewMemberId: "crew-user-paola",
        paidAt: "2026-04-22",
        currency: "DOP",
        allocations: [
          { feeId: paola.feeId!, amount: 600 },
          { feeId: paola.feeId!, amount: 600 },
        ],
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow(/only appear once/i);

    cleanup();
  });
});
