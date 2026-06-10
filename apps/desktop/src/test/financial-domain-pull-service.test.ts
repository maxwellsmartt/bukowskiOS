import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCollaboratorFeeReadService } from "../../electron/main/services/data/collaboratorFeeReadService";
import { createFinancialDomainPullService } from "../../electron/main/services/data/financialDomainPullService";
import { createInvoiceInboxService } from "../../electron/main/services/data/invoiceInboxService";
import { createTreasuryMutationService } from "../../electron/main/services/data/treasuryMutationService";
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
          supplier_ncf: "B0100000456",
          dgii_expense_type: "02-servicios",
          withholding_type: "ISR",
          withholding_rate: 10,
          withholding_amount: 2500,
          fiscal_period: "2026-05",
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
    expect(transactions[0]?.annotation?.supplierNcf).toBe("B0100000456");
    expect(transactions[0]?.annotation?.dgiiExpenseType).toBe("02-servicios");
    expect(transactions[0]?.annotation?.withholdingType).toBe("ISR");
    expect(transactions[0]?.annotation?.withholdingRate).toBe(10);
    expect(transactions[0]?.annotation?.withholdingAmount).toBe(2500);
    expect(transactions[0]?.annotation?.fiscalPeriod).toBe("2026-05");

    cleanup();
  });

  it("materializes pulled counterparty rules onto existing and future local transactions", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-counterparty-rules");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
      {
        id: "bank-rule-sync",
        workspace_id: workspaceId,
        bank_name: "popular",
        account_label: "Popular DOP",
        account_number_masked: null,
        account_number_full: null,
        currency: "DOP",
        account_type: "checking",
        opening_balance: 0,
        opening_balance_date: null,
        is_active: 1,
        notes: null,
        created_at: "2026-05-21T10:00:00.000Z",
        updated_at: "2026-05-21T10:00:00.000Z",
      },
    ]);
    service.applyRemoteTreasuryRows(workspaceId, "bank_transactions", [
      {
        id: "txn-rule-existing",
        workspace_id: workspaceId,
        bank_account_id: "bank-rule-sync",
        import_id: null,
        txn_date: "2026-05-21",
        value_date: null,
        raw_description: "DR PAGO TARJETA CREDITO",
        reference: null,
        serial: null,
        amount: 1250,
        direction: "debit",
        running_balance: null,
        currency: "DOP",
        dedupe_hash: "rule-existing-hash",
        created_at: "2026-05-21T10:01:00.000Z",
      },
    ]);

    expect(
      service.applyRemoteTreasuryRows(workspaceId, "counterparty_rules", [
        {
          id: "counterparty-rule-card-payment",
          workspace_id: workspaceId,
          match_pattern: "DR PAGO TARJETA CREDITO",
          match_type: "exact",
          default_kind: "expense",
          default_category: "Tarjeta de crédito",
          default_counterparty: "Banco Popular",
          default_project_id: null,
          priority: 0,
          is_active: 1,
          created_at: "2026-05-21T10:02:00.000Z",
          updated_at: "2026-05-21T10:02:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    service.applyRemoteTreasuryRows(workspaceId, "bank_transactions", [
      {
        id: "txn-rule-future",
        workspace_id: workspaceId,
        bank_account_id: "bank-rule-sync",
        import_id: null,
        txn_date: "2026-05-22",
        value_date: null,
        raw_description: "DR PAGO TARJETA CREDITO",
        reference: null,
        serial: null,
        amount: 2600,
        direction: "debit",
        running_balance: null,
        currency: "DOP",
        dedupe_hash: "rule-future-hash",
        created_at: "2026-05-22T10:01:00.000Z",
      },
    ]);

    const annotations = database
      .prepare(
        `
          SELECT transaction_id, txn_kind, expense_category, counterparty
          FROM transaction_annotations
          WHERE transaction_id IN ('txn-rule-existing', 'txn-rule-future')
          ORDER BY transaction_id
        `,
      )
      .all() as Array<{ transaction_id: string; txn_kind: string; expense_category: string; counterparty: string }>;
    expect(annotations).toEqual([
      {
        transaction_id: "txn-rule-existing",
        txn_kind: "expense",
        expense_category: "Tarjeta de crédito",
        counterparty: "Banco Popular",
      },
      {
        transaction_id: "txn-rule-future",
        txn_kind: "expense",
        expense_category: "Tarjeta de crédito",
        counterparty: "Banco Popular",
      },
    ]);

    const outboxCount = database
      .prepare(`SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'transaction_annotation'`)
      .get() as { count: number };
    expect(outboxCount.count).toBe(0);

    cleanup();
  });

  it("hydrates pending transaction links by id when transaction_id is null", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-pending-link");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
      {
        id: "card-remote-user-001",
        workspace_id: workspaceId,
        bank_name: "popular",
        account_label: "Visa personal terminada 1234",
        account_number_masked: "****1234",
        account_number_full: "SHOULD_NOT_SURVIVE",
        owner: "user",
        owner_user_id: null,
        owner_user_name_snapshot: "Carlos",
        instrument_kind: "credit_card",
        last4: "1234",
        issuer: "Banco Popular",
        statement_cycle_day: 15,
        payment_due_day: 30,
        reminder_user_id: null,
        currency: "DOP",
        account_type: "other",
        opening_balance: 0,
        opening_balance_date: null,
        is_active: 1,
        notes: null,
        created_at: "2026-06-08T10:00:00.000Z",
        updated_at: "2026-06-08T10:00:00.000Z",
      },
    ]);

    const firstPull = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [
      {
        id: "txn-link-pending-invoice-001",
        workspace_id: workspaceId,
        transaction_id: null,
        payment_instrument_id: "card-remote-user-001",
        linked_entity_type: "invoice_extraction",
        linked_entity_id: "invoice-extraction-remote-001",
        amount_applied: 1250,
        amount_currency: "DOP",
        fx_rate: null,
        allocation_status: "pending",
        cycle_start: "2026-06-01",
        cycle_end: "2026-06-30",
        notes: "Pending card allocation from office",
        created_at: "2026-06-08T10:01:00.000Z",
        updated_at: "2026-06-08T10:01:00.000Z",
      },
    ]);
    const secondPull = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [
      {
        id: "txn-link-pending-invoice-001",
        workspace_id: workspaceId,
        transaction_id: null,
        payment_instrument_id: "card-remote-user-001",
        linked_entity_type: "invoice_extraction",
        linked_entity_id: "invoice-extraction-remote-001",
        amount_applied: 1250,
        amount_currency: "DOP",
        fx_rate: null,
        allocation_status: "pending",
        cycle_start: "2026-06-01",
        cycle_end: "2026-06-30",
        notes: "Duplicate pull should not duplicate",
        created_at: "2026-06-08T10:01:00.000Z",
        updated_at: "2026-06-08T10:01:00.000Z",
      },
    ]);

    expect(firstPull.appliedCount).toBe(1);
    expect(secondPull.appliedCount).toBe(0);
    expect(secondPull.skippedDueToOlderCount).toBe(1);

    const account = database
      .prepare(`SELECT account_number_full, instrument_kind, last4 FROM bank_accounts WHERE id = ?`)
      .get("card-remote-user-001") as { account_number_full: string | null; instrument_kind: string; last4: string };
    expect(account.account_number_full).toBeNull();
    expect(account.instrument_kind).toBe("credit_card");
    expect(account.last4).toBe("1234");

    const links = database
      .prepare(
        `
          SELECT transaction_id, payment_instrument_id, linked_entity_type, allocation_status, amount_applied
          FROM transaction_links
          WHERE id = ?
        `,
      )
      .all("txn-link-pending-invoice-001") as Array<{
      transaction_id: string | null;
      payment_instrument_id: string;
      linked_entity_type: string;
      allocation_status: string;
      amount_applied: number;
    }>;

    expect(links).toEqual([
      {
        transaction_id: null,
        payment_instrument_id: "card-remote-user-001",
        linked_entity_type: "invoice_extraction",
        allocation_status: "pending",
        amount_applied: 1250,
      },
    ]);

    cleanup();
  });

  it("advances the cursor past rows that fail with a permanent constraint violation", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-constraint-cursor");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
      {
        id: "card-remote-user-002",
        workspace_id: workspaceId,
        bank_name: "popular",
        account_label: "Visa empresa terminada 9876",
        account_number_masked: "****9876",
        account_number_full: null,
        owner: "user",
        owner_user_id: null,
        owner_user_name_snapshot: "Carlos",
        instrument_kind: "credit_card",
        last4: "9876",
        issuer: "Banco Popular",
        statement_cycle_day: 15,
        payment_due_day: 30,
        reminder_user_id: null,
        currency: "DOP",
        account_type: "other",
        opening_balance: 0,
        opening_balance_date: null,
        is_active: 1,
        notes: null,
        created_at: "2026-06-08T10:00:00.000Z",
        updated_at: "2026-06-08T10:00:00.000Z",
      },
    ]);

    const baseLink = {
      workspace_id: workspaceId,
      transaction_id: null,
      payment_instrument_id: "card-remote-user-002",
      linked_entity_type: "invoice_extraction",
      linked_entity_id: "invoice-extraction-remote-dup",
      amount_applied: 500,
      amount_currency: "DOP",
      fx_rate: null,
      allocation_status: "pending",
      cycle_start: "2026-06-01",
      cycle_end: "2026-06-30",
      notes: null,
      created_at: "2026-06-08T10:01:00.000Z",
      updated_at: "2026-06-08T10:01:00.000Z",
    };

    const firstPull = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [
      { ...baseLink, id: "txn-link-dedupe-original" },
    ]);
    expect(firstPull.appliedCount).toBe(1);

    // Same dedupe key (entity + instrument) under a different id: the upsert
    // conflicts on idx_txn_links_dedupe_v4 and can never succeed. The cursor
    // must still advance so the puller does not re-fetch this row forever.
    const conflictPull = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [
      { ...baseLink, id: "txn-link-dedupe-divergent", updated_at: "2026-06-09T08:00:00.000Z" },
    ]);

    expect(conflictPull.appliedCount).toBe(0);
    expect(conflictPull.errors).toHaveLength(1);
    expect(conflictPull.errors[0]).toContain("idx_txn_links_dedupe_v4");
    expect(conflictPull.cursorAfter).toBe("2026-06-09T08:00:00.000Z");

    cleanup();
  });

  it("skips transaction links only when a non-null transaction_id is missing", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-missing-link-transaction");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    const result = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [
      {
        id: "txn-link-missing-transaction",
        workspace_id: workspaceId,
        transaction_id: "txn-does-not-exist",
        payment_instrument_id: null,
        linked_entity_type: "invoice",
        linked_entity_id: "invoice-remote-001",
        amount_applied: 500,
        amount_currency: "DOP",
        fx_rate: null,
        allocation_status: "matched",
        cycle_start: null,
        cycle_end: null,
        notes: null,
        created_at: "2026-06-08T10:02:00.000Z",
        updated_at: "2026-06-08T10:02:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.skippedDueToDependencyCount).toBe(1);

    const count = database
      .prepare(`SELECT COUNT(*) AS count FROM transaction_links WHERE id = ?`)
      .get("txn-link-missing-transaction") as { count: number };
    expect(count.count).toBe(0);

    cleanup();
  });

  it("defers transaction links until their payment instrument has been pulled", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-missing-link-instrument");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);
    const remoteLink = {
      id: "txn-link-missing-payment-instrument",
      workspace_id: workspaceId,
      transaction_id: null,
      payment_instrument_id: "card-not-pulled-yet",
      linked_entity_type: "invoice_extraction",
      linked_entity_id: "invoice-extraction-remote-002",
      amount_applied: 875,
      amount_currency: "DOP",
      fx_rate: null,
      allocation_status: "pending",
      cycle_start: "2026-06-01",
      cycle_end: "2026-06-30",
      notes: null,
      created_at: "2026-06-08T10:04:00.000Z",
      updated_at: "2026-06-08T10:04:00.000Z",
    };

    const deferred = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [remoteLink]);

    expect(deferred.appliedCount).toBe(0);
    expect(deferred.skippedDueToDependencyCount).toBe(1);
    expect(deferred.errors).toEqual([]);
    expect(deferred.cursorAfter).toBeNull();

    service.applyRemoteTreasuryRows(workspaceId, "bank_accounts", [
      {
        id: "card-not-pulled-yet",
        workspace_id: workspaceId,
        bank_name: "popular",
        account_label: "Visa personal terminada 9999",
        account_number_masked: "****9999",
        account_number_full: null,
        owner: "user",
        owner_user_id: null,
        owner_user_name_snapshot: "Carlos",
        instrument_kind: "credit_card",
        last4: "9999",
        issuer: "Banco Popular",
        statement_cycle_day: 15,
        payment_due_day: 30,
        reminder_user_id: null,
        currency: "DOP",
        account_type: "other",
        opening_balance: 0,
        opening_balance_date: null,
        is_active: 1,
        notes: null,
        created_at: "2026-06-08T10:03:00.000Z",
        updated_at: "2026-06-08T10:03:00.000Z",
      },
    ]);

    const applied = service.applyRemoteTreasuryRows(workspaceId, "transaction_links", [remoteLink]);

    expect(applied.appliedCount).toBe(1);
    expect(applied.errors).toEqual([]);
    expect(
      database
        .prepare(`SELECT payment_instrument_id FROM transaction_links WHERE id = ?`)
        .get("txn-link-missing-payment-instrument"),
    ).toEqual({ payment_instrument_id: "card-not-pulled-yet" });

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
    expect(result.cursorAfter).toBeNull();

    const annotation = database
      .prepare(`SELECT txn_kind, concept, expense_category FROM transaction_annotations WHERE transaction_id = ?`)
      .get("txn-outbox-annotation") as { txn_kind: string; concept: string; expense_category: string };
    expect(annotation.txn_kind).toBe("expense");
    expect(annotation.concept).toBe("Local concept");
    expect(annotation.expense_category).toBe("Service payments");

    cleanup();
  });

  it("keeps the treasury annotation cursor before rows with missing transaction dependencies", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-annotation-retry");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    const result = service.applyRemoteTreasuryRows(workspaceId, "transaction_annotations", [
      {
        transaction_id: "txn-not-pulled-yet",
        workspace_id: workspaceId,
        txn_kind: "expense",
        concept: "Remote annotation should retry",
        expense_category: "Services",
        is_internal_transfer: 0,
        reimbursement_status: "n/a",
        fiscal_status: "pending",
        updated_at: "2026-05-19T10:04:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.skippedDueToDependencyCount).toBe(1);
    expect(result.cursorAfter).toBeNull();

    const cursor = database
      .prepare(`SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = 'transaction_annotations'`)
      .get(workspaceId) as { last_synced_at: string | null } | undefined;
    expect(cursor?.last_synced_at ?? null).toBeNull();

    cleanup();
  });

  it("hydrates finance business rows for quotes, invoices, currency settings and finance entries", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-pull-business");
    const workspaceId = "workspace-metadata";
    const service = createFinancialDomainPullService(database);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "currency_settings", [
        {
          id: "remote-currency-settings",
          workspace_id: workspaceId,
          base_currency: "DOP",
          default_quote_currency: "USD",
          enabled_currencies_json: ["DOP", "USD"],
          default_rate_source: "manual",
          default_rate_type: "manual",
          default_itbis_rate: 0.18,
          default_quote_validity_days: 30,
          sirecine_number: "SIR-REMOTE",
          workspace_logo_url: null,
          workspace_seal_url: null,
          workspace_signature_url: null,
          ncf_series_active: "B01",
          ncf_sequence_next: 10,
          ncf_sequence_max: 100,
          ncf_expires_at: "2026-12-31",
          created_at: "2026-05-22T10:00:00.000Z",
          updated_at: "2026-05-22T10:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "quotes", [
        {
          id: "quote-remote-001",
          workspace_id: workspaceId,
          quote_number: "2026-0001",
          quote_year: 2026,
          quote_sequence: 1,
          status: "approved",
          quote_date: "2026-05-22",
          validity_days: 30,
          valid_until: "2026-06-21",
          client_id: null,
          client_name_snapshot: "Remote Client",
          client_rnc_snapshot: null,
          production_company_id: null,
          production_company_name_snapshot: null,
          production_pur_snapshot: null,
          workspace_sirecine_snapshot: "SIR-REMOTE",
          attention_name: null,
          attention_phone: null,
          project_id: null,
          project_name_snapshot: null,
          production_name: "Remote Production",
          description: "Remote quote",
          package_title: "Standard",
          currency: "USD",
          base_currency: "DOP",
          exchange_rate: 58.5,
          exchange_rate_source: "manual",
          exchange_rate_type: "manual",
          exchange_rate_effective_date: "2026-05-22",
          exchange_rate_snapshot_json: { source: "remote" },
          tax_profile: "standard_itbis",
          itbis_rate: 0.18,
          tax_added_to_total: 1,
          tax_notes: null,
          subtotal_amount: 1000,
          discount_amount: 0,
          discount_rate: null,
          tax_amount: 180,
          total_amount: 1180,
          base_currency_total_amount: 69030,
          observations: null,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_by_actor_type: "user",
          source_channel: "desktop",
          sent_at: null,
          approved_at: "2026-05-22T11:00:00.000Z",
          rejected_at: null,
          expired_at: null,
          cancelled_at: null,
          created_at: "2026-05-22T10:10:00.000Z",
          updated_at: "2026-05-22T11:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "quote_items", [
        {
          id: "quote-remote-001-item-001-0",
          workspace_id: workspaceId,
          quote_id: "quote-remote-001",
          sort_order: 1,
          quantity: 1,
          title: "Camera package",
          description: null,
          duration_value: null,
          duration_unit: null,
          unit_price: 1000,
          line_subtotal: 1000,
          discount_rate: null,
          discount_amount: 0,
          tax_behavior: "follows_quote",
          tax_rate: null,
          tax_amount: 180,
          line_total: 1180,
          notes: null,
          metadata_json: { remote: true },
          created_at: "2026-05-22T10:10:01.000Z",
          updated_at: "2026-05-22T10:10:01.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "invoices", [
        {
          id: "invoice-remote-001",
          workspace_id: workspaceId,
          source_quote_id: "quote-remote-001",
          invoice_number: "2026-0001",
          invoice_year: 2026,
          invoice_sequence: 1,
          ncf: "B0100000010",
          ncf_series: "B01",
          ncf_sequence: 10,
          status: "partially_paid",
          issue_date: "2026-05-23",
          due_date: "2026-06-22",
          payment_terms_days: 30,
          client_id: null,
          client_name_snapshot: "Remote Client",
          client_rnc_snapshot: null,
          production_company_id: null,
          production_company_name_snapshot: null,
          production_pur_snapshot: null,
          workspace_sirecine_snapshot: "SIR-REMOTE",
          attention_name: null,
          attention_phone: null,
          project_id: null,
          project_name_snapshot: null,
          production_name: "Remote Production",
          description: "Remote invoice",
          package_title: "Standard",
          currency: "USD",
          base_currency: "DOP",
          exchange_rate: 58.5,
          exchange_rate_source: "manual",
          exchange_rate_type: "manual",
          exchange_rate_effective_date: "2026-05-22",
          exchange_rate_snapshot_json: { source: "remote" },
          tax_profile: "standard_itbis",
          itbis_rate: 0.18,
          tax_added_to_total: 1,
          tax_notes: null,
          subtotal_amount: 1000,
          discount_amount: 0,
          discount_rate: null,
          tax_amount: 180,
          total_amount: 1180,
          base_currency_total_amount: 69030,
          paid_amount: 500,
          outstanding_amount: 680,
          observations: null,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_by_actor_type: "user",
          source_channel: "desktop",
          issued_at: "2026-05-23T10:00:00.000Z",
          cancelled_at: null,
          voided_at: null,
          fully_paid_at: null,
          created_at: "2026-05-23T09:00:00.000Z",
          updated_at: "2026-05-23T10:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "invoice_payments", [
        {
          id: "invoice-payment-remote-001",
          workspace_id: workspaceId,
          invoice_id: "invoice-remote-001",
          paid_at: "2026-05-24",
          amount: 500,
          currency: "USD",
          exchange_rate: 58.5,
          base_currency_amount: 29250,
          payment_method: "bank_transfer",
          reference: "PAY-REMOTE",
          notes: null,
          recorded_by_user_id: null,
          created_at: "2026-05-24T09:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    expect(
      service.applyRemoteFinanceBusinessRows(workspaceId, "financial_entries", [
        {
          id: "finance-remote-001",
          workspace_id: workspaceId,
          entry_type: "expense",
          category: "Services",
          amount: 500,
          currency: "USD",
          exchange_rate: 58.5,
          base_currency_amount: 29250,
          status: "Approved",
          project_id: null,
          project_unit_id: null,
          asset_id: null,
          incident_id: null,
          created_by_user_id: null,
          entry_date: "2026-05-24",
          description: "Remote finance entry",
          notes: null,
          created_at: "2026-05-24T10:00:00.000Z",
          updated_at: "2026-05-24T10:00:00.000Z",
        },
      ]).appliedCount,
    ).toBe(1);

    const settings = database
      .prepare(`SELECT id, default_quote_currency, enabled_currencies_json FROM currency_settings WHERE workspace_id = ?`)
      .get(workspaceId) as { id: string; default_quote_currency: string; enabled_currencies_json: string };
    expect(settings.id).toBe(`currency-settings-${workspaceId}`);
    expect(settings.default_quote_currency).toBe("USD");
    expect(JSON.parse(settings.enabled_currencies_json)).toEqual(["DOP", "USD"]);

    const quoteItem = database
      .prepare(`SELECT metadata_json FROM quote_items WHERE id = ?`)
      .get("quote-remote-001-item-001-0") as { metadata_json: string };
    expect(JSON.parse(quoteItem.metadata_json)).toEqual({ remote: true });

    const invoice = database
      .prepare(`SELECT status, paid_amount, outstanding_amount FROM invoices WHERE id = ?`)
      .get("invoice-remote-001") as { status: string; paid_amount: number; outstanding_amount: number };
    expect(invoice.status).toBe("partially_paid");
    expect(invoice.paid_amount).toBe(500);
    expect(invoice.outstanding_amount).toBe(680);

    const payment = database
      .prepare(`SELECT reference FROM invoice_payments WHERE id = ?`)
      .get("invoice-payment-remote-001") as { reference: string };
    expect(payment.reference).toBe("PAY-REMOTE");

    const entry = database
      .prepare(`SELECT created_by_user_id FROM financial_entries WHERE id = ?`)
      .get("finance-remote-001") as { created_by_user_id: string };
    expect(entry.created_by_user_id).toBe("user-ops");

    cleanup();
  });

  it("replaces an invoice extraction's project tags from the pulled child rows", () => {
    const { cleanup, database } = createTestDatabase("financial-pull-invoice-extraction-tags");
    const workspaceId = "workspace-metadata";
    // The extraction table is created lazily by the inbox service.
    createInvoiceInboxService(database, {
      userDataPath: mkdtempSync(join(tmpdir(), "pull-inbox-")),
      treasuryMutations: createTreasuryMutationService(database),
    });
    const service = createFinancialDomainPullService(database);

    const extractionRow = {
      id: "inv-remote-1",
      workspace_id: workspaceId,
      batch_id: "batch-remote",
      status: "extracted",
      original_name: "factura.png",
      storage_path: "/tmp/factura.png",
      mime_type: "image/png",
      byte_size: 10,
      created_at: "2026-05-24T10:00:00.000Z",
      updated_at: "2026-05-24T10:00:00.000Z",
    };

    // First pull: one project tag.
    service.applyRemoteFinanceBusinessRows(workspaceId, "invoice_extractions", [extractionRow], [
      {
        id: "tag-a",
        workspace_id: workspaceId,
        invoice_extraction_id: "inv-remote-1",
        project_id: "project-aurora",
        project_name_snapshot: "Aurora",
        created_at: "2026-05-24T10:00:00.000Z",
      },
    ]);
    expect(
      (database.prepare(`SELECT project_id FROM invoice_extraction_projects WHERE invoice_extraction_id = ?`).all("inv-remote-1") as Array<{ project_id: string }>).map((r) => r.project_id),
    ).toEqual(["project-aurora"]);

    // Second pull (newer updated_at): the tag set changed — old tag must be
    // gone, new tag present (replace semantics, not additive).
    service.applyRemoteFinanceBusinessRows(
      workspaceId,
      "invoice_extractions",
      [{ ...extractionRow, updated_at: "2026-05-25T10:00:00.000Z" }],
      [
        {
          id: "tag-b",
          workspace_id: workspaceId,
          invoice_extraction_id: "inv-remote-1",
          project_id: "project-borealis",
          project_name_snapshot: "Borealis",
          created_at: "2026-05-25T10:00:00.000Z",
        },
      ],
    );
    const tags = (
      database.prepare(`SELECT project_id FROM invoice_extraction_projects WHERE invoice_extraction_id = ?`).all("inv-remote-1") as Array<{ project_id: string }>
    ).map((r) => r.project_id);
    expect(tags).toEqual(["project-borealis"]);

    cleanup();
  });
});
