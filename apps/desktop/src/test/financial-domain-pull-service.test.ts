import { describe, expect, it } from "vitest";

import { createCollaboratorFeeReadService } from "../../electron/main/services/data/collaboratorFeeReadService";
import { createFinancialDomainPullService } from "../../electron/main/services/data/financialDomainPullService";
import { createTreasuryReadService } from "../../electron/main/services/data/treasuryReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("financialDomainPullService", () => {
  it("hydrates treasury accounts, imports, transactions and annotations from remote rows", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-treasury");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    expect(
      service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
        {
          id: "bank-remote-popular-dop",
          workspace_id: workspaceId,
          bank_name: "popular",
          account_label: "Popular DOP remote",
          account_number_masked: "1234",
          account_number_full: null,
          currency: "DOP",
          account_type: "checking",
          opening_balance: 1000,
          opening_balance_date: "2026-05-01",
          is_active: 1,
          notes: null,
          created_at: "2026-05-20T10:00:00.000Z",
          updated_at: "2026-05-20T10:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteTreasuryRows(workspaceId, "bank_statement_imports", [
        {
          id: "import-remote-popular-001",
          workspace_id: workspaceId,
          bank_account_id: "bank-remote-popular-dop",
          source_format: "csv",
          original_filename: "popular-may.csv",
          period_start: "2026-05-01",
          period_end: "2026-05-31",
          row_count: 1,
          inserted_count: 1,
          duplicate_count: 0,
          imported_by_user_id: null,
          notes: null,
          created_at: "2026-05-20T10:01:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteTreasuryRows(workspaceId, "bank_transactions", [
        {
          id: "txn-remote-service-payment",
          workspace_id: workspaceId,
          bank_account_id: "bank-remote-popular-dop",
          import_id: "import-remote-popular-001",
          txn_date: "2026-05-20",
          value_date: "2026-05-20",
          raw_description: "PAGO SERVICIOS CARLOS",
          reference: "REF-001",
          serial: null,
          amount: 25000,
          direction: "debit",
          running_balance: 975000,
          currency: "DOP",
          dedupe_hash: "remote-hash-service-payment",
          created_at: "2026-05-20T10:02:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteTreasuryRows(workspaceId, "transaction_annotations", [
        {
          transaction_id: "txn-remote-service-payment",
          workspace_id: workspaceId,
          txn_kind: "expense",
          concept: "Servicios",
          counterparty: "Carlos",
          counterparty_rnc: null,
          expense_category: "Service payments",
          is_internal_transfer: 0,
          reimbursement_status: "n/a",
          claimed_amount: 25000,
          deductible_amount: 25000,
          fiscal_status: "pending",
          reviewed_by_user_id: null,
          reviewed_at: null,
          support_doc_file_id: null,
          notes: "Hydrated from Supabase",
          classified_by_user_id: null,
          updated_at: "2026-05-20T10:03:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    const treasuryReads = createTreasuryReadService(database);
    const accounts = treasuryReads.getAccounts(workspaceId);
    const transactions = treasuryReads.listTransactions({ workspaceId, limit: 10 });

    expect(accounts.some((account) => account.id === "bank-remote-popular-dop")).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.id).toBe("txn-remote-service-payment");
    expect(transactions[0]?.annotation?.expenseCategory).toBe("Service payments");

    cleanup();
  });

  it("hydrates collaborator fees and payments, creating a placeholder crew member when needed", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-collaborators");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    const feeResult = service.applyRemoteCollaboratorPaymentRows(workspaceId, "collaborator_fees", [
      {
        id: "fee-remote-paola-001",
        workspace_id: workspaceId,
        crew_member_id: "crew-remote-paola",
        project_id: null,
        project_unit_id: null,
        department_id: null,
        source_assignment_id: null,
        fee_type: "day_rate",
        description: "Remote camera support",
        agreed_amount: 1200,
        currency: "USD",
        exchange_rate: 1,
        base_currency_amount: 1200,
        paid_amount: 400,
        outstanding_amount: 800,
        status: "partially_paid",
        expected_payment_date: "2026-05-25",
        approved_at: "2026-05-20T12:00:00.000Z",
        cancelled_at: null,
        paid_at: null,
        created_by_user_id: null,
        updated_by_user_id: null,
        created_by_actor_type: "user",
        source_channel: "desktop",
        notes: null,
        created_at: "2026-05-20T11:00:00.000Z",
        updated_at: "2026-05-20T11:00:00.000Z",
      },
    ]);

    expect(feeResult.appliedCount).toBe(1);
    expect(
      service.applyRemoteCollaboratorPaymentRows(workspaceId, "collaborator_payment_batches", [
        {
          id: "collab-batch-remote-001",
          workspace_id: workspaceId,
          crew_member_id: "crew-remote-paola",
          paid_at: "2026-05-21",
          amount: 400,
          currency: "USD",
          exchange_rate: 1,
          base_currency_amount: 400,
          payment_method: "bank_transfer",
          reference: "WIRE-001",
          notes: "Partial remote payment",
          recorded_by_user_id: null,
          created_by_actor_type: "user",
          source_channel: "desktop",
          created_at: "2026-05-21T09:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);
    expect(
      service.applyRemoteCollaboratorPaymentRows(workspaceId, "collaborator_fee_payments", [
        {
          id: "collab-payment-remote-001",
          workspace_id: workspaceId,
          fee_id: "fee-remote-paola-001",
          payment_batch_id: "collab-batch-remote-001",
          amount: 400,
          currency: "USD",
          created_at: "2026-05-21T09:00:01.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    const placeholderCrew = database
      .prepare(`SELECT full_name FROM crew_members WHERE id = ?`)
      .get("crew-remote-paola") as { full_name: string } | undefined;
    expect(placeholderCrew?.full_name).toContain("Remote collaborator");

    const collaboratorReads = createCollaboratorFeeReadService(database);
    const detail = collaboratorReads.getFeeDetail(workspaceId, "fee-remote-paola-001");

    expect(detail?.status).toBe("partially_paid");
    expect(detail?.paidAmount).toBe(400);
    expect(detail?.outstandingAmount).toBe(800);
    expect(detail?.payments).toHaveLength(1);
    expect(detail?.payments[0]?.reference).toBe("WIRE-001");

    cleanup();
  });

  it("does not overwrite a local treasury annotation while its outbox item is pending", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-outbox");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
      {
        id: "bank-outbox-test",
        workspace_id: workspaceId,
        bank_name: "popular",
        account_label: "Popular outbox",
        currency: "DOP",
        opening_balance: 0,
        is_active: 1,
        created_at: "2026-05-19T10:00:00.000Z",
        updated_at: "2026-05-19T10:00:00.000Z",
      },
    ]);
    service.applyRemoteTreasuryRows(workspaceId, "bank_transactions", [
      {
        id: "txn-outbox-annotation",
        workspace_id: workspaceId,
        bank_account_id: "bank-outbox-test",
        import_id: null,
        txn_date: "2026-05-19",
        value_date: null,
        raw_description: "LOCAL CLASSIFICATION",
        reference: null,
        serial: null,
        amount: 100,
        direction: "debit",
        running_balance: null,
        currency: "DOP",
        dedupe_hash: "outbox-annotation-hash",
        created_at: "2026-05-19T10:01:00.000Z",
      },
    ]);
    service.applyRemoteTreasuryRows(workspaceId, "transaction_annotations", [
      {
        transaction_id: "txn-outbox-annotation",
        workspace_id: workspaceId,
        txn_kind: "expense",
        concept: "Local concept",
        expense_category: "Service payments",
        is_internal_transfer: 0,
        reimbursement_status: "n/a",
        fiscal_status: "pending",
        updated_at: "2026-05-19T10:02:00.000Z",
      },
    ]);

    database
      .prepare(
        `INSERT INTO sync_outbox (id, workspace_id, entity_type, entity_id, operation_type, payload_json, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, 'transaction_annotation', ?, 'update', '{}', 'pending', 0, ?, ?)`,
      )
      .run(
        "outbox-annotation-001",
        workspaceId,
        "txn-outbox-annotation",
        "2026-05-19T10:03:00.000Z",
        "2026-05-19T10:03:00.000Z",
      );

    const result = service.applyRemoteTreasuryRows(workspaceId, "transaction_annotations", [
      {
        transaction_id: "txn-outbox-annotation",
        workspace_id: workspaceId,
        txn_kind: "tax",
        concept: "Remote concept should not win yet",
        expense_category: "Taxes",
        is_internal_transfer: 0,
        reimbursement_status: "n/a",
        fiscal_status: "pending",
        updated_at: "2026-05-19T10:04:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.skippedDueToOutboxCount).toBe(1);

    const annotation = database
      .prepare(`SELECT txn_kind, concept, expense_category FROM transaction_annotations WHERE transaction_id = ?`)
      .get("txn-outbox-annotation") as { txn_kind: string; concept: string; expense_category: string };
    expect(annotation.txn_kind).toBe("expense");
    expect(annotation.concept).toBe("Local concept");
    expect(annotation.expense_category).toBe("Service payments");

    cleanup();
  });
});
