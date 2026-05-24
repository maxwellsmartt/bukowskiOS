import type { DatabaseSync } from "node:sqlite";

import type {
  ApproveCollaboratorFeeCommand,
  CancelCollaboratorFeeCommand,
  CollaboratorFeeInput,
  CollaboratorFeeMutationResult,
  CollaboratorFeeStatus,
  CreateCollaboratorFeeCommand,
  RecordCollaboratorPaymentCommand,
  UpdateCollaboratorFeeCommand,
} from "@contracts";

const defaultActorUserId = "user-ops";

const normalizeOptionalText = (value?: string | null) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const next = value.trim();
  return next ? next : null;
};

const roundMoney = (value: number) => Number(value.toFixed(2));

const buildFailedCommandMessage = (label: string, previousError?: string | null) =>
  previousError
    ? `This command id already failed once for ${label}: ${previousError}`
    : `This command id already failed once for ${label}. Generate a new action and retry.`;

const createCommandReceiptHelpers = (db: DatabaseSync) => ({
  getExistingReceipt(commandId: string) {
    return db
      .prepare("SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ? LIMIT 1")
      .get(commandId) as { outcome_status: string; error_message: string | null } | undefined;
  },
  insertReceipt: db.prepare(
    `
      INSERT OR REPLACE INTO command_receipts (
        command_id, workspace_id, actor_user_id, actor_type, source_channel,
        executed_at, outcome_status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ),
});

const enqueueOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: "collaborator_fee" | "collaborator_payment",
  entityId: string,
  payload: unknown,
  id: string,
  now: string,
) => {
  db.prepare(
    `
      INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, event_id, operation_type,
        payload_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'upsert', ?, 'pending', ?, ?)
    `,
  ).run(id, workspaceId, entityType, entityId, JSON.stringify(payload), now, now);
};

const loadWorkspaceBaseCurrency = (db: DatabaseSync, workspaceId: string) =>
  (db.prepare("SELECT base_currency FROM workspaces WHERE id = ? LIMIT 1").get(workspaceId) as { base_currency: string } | undefined)
    ?.base_currency ?? "DOP";

const assertWorkspaceEntity = (
  db: DatabaseSync,
  table: "crew_members" | "projects" | "project_units" | "departments" | "project_unit_crew_assignments",
  id: string | null | undefined,
  workspaceId: string,
  label: string,
) => {
  if (!id) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND workspace_id = ? LIMIT 1`).get(id, workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error(`${label} not found in this workspace.`);
  }
  return row;
};

const resolveFeeInput = (db: DatabaseSync, workspaceId: string, input: CollaboratorFeeInput) => {
  const crew = assertWorkspaceEntity(db, "crew_members", input.crewMemberId, workspaceId, "Crew member");
  if (!crew) throw new Error("Crew member is required.");

  let projectId = input.projectId ?? null;
  let projectUnitId = input.projectUnitId ?? null;
  let departmentId = input.departmentId ?? null;

  const assignment = assertWorkspaceEntity(
    db,
    "project_unit_crew_assignments",
    input.sourceAssignmentId ?? null,
    workspaceId,
    "Crew assignment",
  );
  if (assignment) {
    if (assignment.crew_member_id !== input.crewMemberId) {
      throw new Error("That assignment belongs to another crew member.");
    }
    projectUnitId = projectUnitId ?? String(assignment.project_unit_id);
  }

  const unit = assertWorkspaceEntity(db, "project_units", projectUnitId, workspaceId, "Project unit");
  if (unit) {
    projectId = projectId ?? String(unit.project_id);
  }

  assertWorkspaceEntity(db, "projects", projectId, workspaceId, "Project");
  assertWorkspaceEntity(db, "departments", departmentId, workspaceId, "Department");

  const workspaceCurrency = loadWorkspaceBaseCurrency(db, workspaceId);
  const currency = input.currency.trim().toUpperCase() || workspaceCurrency;
  const exchangeRate = input.exchangeRate ?? (currency === workspaceCurrency ? 1 : null);
  const baseCurrencyAmount =
    input.baseCurrencyAmount ?? (exchangeRate !== null ? roundMoney(input.agreedAmount * exchangeRate) : null);

  return {
    projectId,
    projectUnitId,
    departmentId,
    sourceAssignmentId: input.sourceAssignmentId ?? null,
    currency,
    exchangeRate,
    baseCurrencyAmount,
    description: normalizeOptionalText(input.description),
    expectedPaymentDate: normalizeOptionalText(input.expectedPaymentDate),
    notes: normalizeOptionalText(input.notes),
  };
};

type FeeRecord = {
  id: string;
  workspace_id: string;
  crew_member_id: string;
  agreed_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  currency: string;
  exchange_rate: number | null;
  status: CollaboratorFeeStatus;
};

const loadFee = (db: DatabaseSync, workspaceId: string, feeId: string) =>
  db.prepare("SELECT * FROM collaborator_fees WHERE workspace_id = ? AND id = ? LIMIT 1").get(workspaceId, feeId) as
    | FeeRecord
    | undefined;

const statusAfterPayment = (paidAmount: number, outstandingAmount: number): CollaboratorFeeStatus => {
  if (outstandingAmount <= 0.005) return "paid";
  if (paidAmount > 0) return "partially_paid";
  return "approved";
};

export const createCollaboratorFeeMutationService = (db: DatabaseSync) => ({
  createFee(input: CreateCollaboratorFeeCommand): CollaboratorFeeMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    const feeId = `crewfee-${input.commandId}`;
    if (existing?.outcome_status === "success") {
      return { commandId: input.commandId, feeId, repeated: true, summary: "Collaborator fee was already created." };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("collaborator fee creation", existing.error_message));
    }

    const resolved = resolveFeeInput(db, input.workspaceId, input);
    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          INSERT INTO collaborator_fees (
            id, workspace_id, crew_member_id, project_id, project_unit_id, department_id,
            source_assignment_id, fee_type, description, agreed_amount, currency,
            exchange_rate, base_currency_amount, paid_amount, outstanding_amount,
            status, expected_payment_date, created_by_user_id, updated_by_user_id,
            created_by_actor_type, source_channel, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        feeId,
        input.workspaceId,
        input.crewMemberId,
        resolved.projectId,
        resolved.projectUnitId,
        resolved.departmentId,
        resolved.sourceAssignmentId,
        input.feeType.trim(),
        resolved.description ?? null,
        roundMoney(input.agreedAmount),
        resolved.currency,
        resolved.exchangeRate,
        resolved.baseCurrencyAmount,
        roundMoney(input.agreedAmount),
        resolved.expectedPaymentDate ?? null,
        defaultActorUserId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        resolved.notes ?? null,
        now,
        now,
      );
      enqueueOutbox(db, input.workspaceId, "collaborator_fee", feeId, { kind: "collaborator_fee.create", feeId }, `sync-${input.commandId}`, now);
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "failed", error instanceof Error ? error.message : "Collaborator fee creation failed.");
      throw error;
    }

    return { commandId: input.commandId, feeId, repeated: false, summary: "Collaborator fee created as draft." };
  },

  updateFee(input: UpdateCollaboratorFeeCommand): CollaboratorFeeMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return { commandId: input.commandId, feeId: input.feeId, repeated: true, summary: "Collaborator fee update was already applied." };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("collaborator fee update", existing.error_message));
    }
    const current = loadFee(db, input.workspaceId, input.feeId);
    if (!current) throw new Error("Collaborator fee not found.");
    if (current.status === "paid" || current.status === "cancelled") {
      throw new Error("Paid or cancelled collaborator fees cannot be edited.");
    }
    if (current.paid_amount > input.agreedAmount) {
      throw new Error("Agreed amount cannot be lower than the amount already paid.");
    }

    const resolved = resolveFeeInput(db, input.workspaceId, input);
    const now = new Date().toISOString();
    const nextOutstanding = roundMoney(input.agreedAmount - current.paid_amount);
    const nextStatus = current.paid_amount > 0 ? statusAfterPayment(current.paid_amount, nextOutstanding) : current.status;

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          UPDATE collaborator_fees
          SET crew_member_id = ?, project_id = ?, project_unit_id = ?, department_id = ?,
              source_assignment_id = ?, fee_type = ?, description = ?, agreed_amount = ?,
              currency = ?, exchange_rate = ?, base_currency_amount = ?,
              outstanding_amount = ?, status = ?, expected_payment_date = ?,
              updated_by_user_id = ?, notes = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `,
      ).run(
        input.crewMemberId,
        resolved.projectId,
        resolved.projectUnitId,
        resolved.departmentId,
        resolved.sourceAssignmentId,
        input.feeType.trim(),
        resolved.description ?? null,
        roundMoney(input.agreedAmount),
        resolved.currency,
        resolved.exchangeRate,
        resolved.baseCurrencyAmount,
        nextOutstanding,
        nextStatus,
        resolved.expectedPaymentDate ?? null,
        defaultActorUserId,
        resolved.notes ?? null,
        now,
        input.workspaceId,
        input.feeId,
      );
      enqueueOutbox(db, input.workspaceId, "collaborator_fee", input.feeId, { kind: "collaborator_fee.update", feeId: input.feeId }, `sync-${input.commandId}`, now);
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "failed", error instanceof Error ? error.message : "Collaborator fee update failed.");
      throw error;
    }

    return { commandId: input.commandId, feeId: input.feeId, repeated: false, summary: "Collaborator fee updated." };
  },

  approveFee(input: ApproveCollaboratorFeeCommand): CollaboratorFeeMutationResult {
    return this.setFeeStatus(input, "approved", "Collaborator fee approved.");
  },

  cancelFee(input: CancelCollaboratorFeeCommand): CollaboratorFeeMutationResult {
    const fee = loadFee(db, input.workspaceId, input.feeId);
    if (fee?.paid_amount && fee.paid_amount > 0) {
      throw new Error("Collaborator fees with recorded payments cannot be cancelled.");
    }
    return this.setFeeStatus(input, "cancelled", "Collaborator fee cancelled.", input.reason);
  },

  setFeeStatus(
    input: ApproveCollaboratorFeeCommand,
    status: "approved" | "cancelled",
    summary: string,
    reason?: string | null,
  ): CollaboratorFeeMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      return { commandId: input.commandId, feeId: input.feeId, repeated: true, summary };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("collaborator fee status change", existing.error_message));
    }
    const fee = loadFee(db, input.workspaceId, input.feeId);
    if (!fee) throw new Error("Collaborator fee not found.");
    if (fee.status === "paid") throw new Error("Paid collaborator fees cannot change status.");
    if (fee.status === "cancelled") throw new Error("Cancelled collaborator fees cannot change status.");

    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      db.prepare(
        `
          UPDATE collaborator_fees
          SET status = ?,
              approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
              cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
              notes = CASE WHEN ? IS NULL THEN notes ELSE TRIM(COALESCE(notes, '') || char(10) || ?) END,
              updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `,
      ).run(status, status, now, status, now, reason ?? null, reason ?? null, now, input.workspaceId, input.feeId);
      enqueueOutbox(db, input.workspaceId, "collaborator_fee", input.feeId, { kind: `collaborator_fee.${status}`, feeId: input.feeId }, `sync-${input.commandId}`, now);
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "failed", error instanceof Error ? error.message : "Collaborator fee status change failed.");
      throw error;
    }
    return { commandId: input.commandId, feeId: input.feeId, repeated: false, summary };
  },

  recordPayment(input: RecordCollaboratorPaymentCommand): CollaboratorFeeMutationResult {
    const receiptHelpers = createCommandReceiptHelpers(db);
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    const paymentBatchId = `crewpay-${input.commandId}`;
    if (existing?.outcome_status === "success") {
      return { commandId: input.commandId, paymentBatchId, repeated: true, summary: "Collaborator payment was already recorded." };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("collaborator payment", existing.error_message));
    }
    assertWorkspaceEntity(db, "crew_members", input.crewMemberId, input.workspaceId, "Crew member");
    const currency = input.currency.trim().toUpperCase();
    const seenFeeIds = new Set<string>();
    const fees = input.allocations.map((allocation) => {
      if (seenFeeIds.has(allocation.feeId)) {
        throw new Error("Each collaborator fee can only appear once in a payment batch.");
      }
      seenFeeIds.add(allocation.feeId);
      const fee = loadFee(db, input.workspaceId, allocation.feeId);
      if (!fee) throw new Error("Collaborator fee not found.");
      if (fee.crew_member_id !== input.crewMemberId) throw new Error("All paid fees must belong to the selected collaborator.");
      if (fee.currency !== currency) throw new Error("All paid fees must use the selected currency.");
      if (fee.status === "draft" || fee.status === "cancelled") throw new Error("Only approved or scheduled fees can be paid.");
      if (allocation.amount > fee.outstanding_amount + 0.005) throw new Error("Payment allocation cannot exceed fee outstanding amount.");
      return { fee, amount: roundMoney(allocation.amount) };
    });
    const total = roundMoney(fees.reduce((sum, row) => sum + row.amount, 0));
    if (total <= 0) throw new Error("Collaborator payment amount must be positive.");
    const workspaceCurrency = loadWorkspaceBaseCurrency(db, input.workspaceId);
    const exchangeRate = input.exchangeRate ?? (currency === workspaceCurrency ? 1 : null);
    const baseCurrencyAmount = exchangeRate !== null ? roundMoney(total * exchangeRate) : null;
    const now = new Date().toISOString();

    db.exec("BEGIN");
    try {
      db.prepare(
        `
          INSERT INTO collaborator_payment_batches (
            id, workspace_id, crew_member_id, paid_at, amount, currency,
            exchange_rate, base_currency_amount, payment_method, reference, notes,
            recorded_by_user_id, created_by_actor_type, source_channel, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        paymentBatchId,
        input.workspaceId,
        input.crewMemberId,
        input.paidAt,
        total,
        currency,
        exchangeRate,
        baseCurrencyAmount,
        normalizeOptionalText(input.paymentMethod) ?? null,
        normalizeOptionalText(input.reference) ?? null,
        normalizeOptionalText(input.notes) ?? null,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
      );
      fees.forEach(({ fee, amount }, index) => {
        const nextPaid = roundMoney(fee.paid_amount + amount);
        const nextOutstanding = roundMoney(fee.agreed_amount - nextPaid);
        const nextStatus = statusAfterPayment(nextPaid, nextOutstanding);
        db.prepare(
          `
            INSERT INTO collaborator_fee_payments (
              id, workspace_id, fee_id, payment_batch_id, amount, currency, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(`${paymentBatchId}-fee-${index + 1}`, input.workspaceId, fee.id, paymentBatchId, amount, currency, now);
        db.prepare(
          `
            UPDATE collaborator_fees
            SET paid_amount = ?, outstanding_amount = ?, status = ?,
                paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
                updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `,
        ).run(nextPaid, nextOutstanding, nextStatus, nextStatus, input.paidAt, now, input.workspaceId, fee.id);
      });
      enqueueOutbox(db, input.workspaceId, "collaborator_payment", paymentBatchId, { kind: "collaborator_payment.record", paymentBatchId }, `sync-${input.commandId}`, now);
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      receiptHelpers.insertReceipt.run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now, "failed", error instanceof Error ? error.message : "Collaborator payment failed.");
      throw error;
    }

    return { commandId: input.commandId, paymentBatchId, repeated: false, summary: `Recorded ${currency} ${total.toFixed(2)} collaborator payment.` };
  },
});

export type CollaboratorFeeMutationService = ReturnType<typeof createCollaboratorFeeMutationService>;
