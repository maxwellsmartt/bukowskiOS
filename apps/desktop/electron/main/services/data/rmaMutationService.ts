import type { DatabaseSync } from "node:sqlite";

import type { CreateRmaCaseCommand, RmaCaseAssetInput, RmaCaseMutationResult, RmaCaseStatus, UpdateRmaCaseCommand } from "@contracts";

import { enqueueOperationalSnapshotOutbox } from "./operationalSnapshotService";
import { resolveAuthorizedActor } from "./mutationAuthorization";

const ensureValue = (value: string | undefined, label: string) => {
  const nextValue = value?.trim() ?? "";

  if (!nextValue) {
    throw new Error(`${label} is required.`);
  }

  return nextValue;
};

const optionalValue = (value: string | undefined) => {
  const nextValue = value?.trim() ?? "";
  return nextValue || null;
};

const uniqueAssetItems = (assetItems: RmaCaseAssetInput[]) => {
  const seen = new Set<string>();
  const normalized = assetItems
    .map((item) => ({
      assetId: item.assetId.trim(),
      equipmentYear: optionalValue(item.equipmentYear),
      issueSummary: ensureValue(item.issueSummary, "Issue summary"),
    }))
    .filter((item) => item.assetId);

  return normalized.filter((item) => {
    if (seen.has(item.assetId)) {
      return false;
    }

    seen.add(item.assetId);
    return true;
  });
};

const loadManufacturer = (db: DatabaseSync, workspaceId: string, manufacturerId: string) => {
  const row = db
    .prepare(
      `
        SELECT id, name, COALESCE(support_email, '') AS support_email
        FROM manufacturers
        WHERE workspace_id = ?
          AND id = ?
          AND is_active = 1
        LIMIT 1
      `,
    )
    .get(workspaceId, manufacturerId) as { id: string; name: string; support_email: string } | undefined;

  if (!row) {
    throw new Error("Selected manufacturer was not found.");
  }

  return row;
};

const assertAssetsEligibleForCreate = (db: DatabaseSync, workspaceId: string, assetIds: string[]) => {
  if (!assetIds.length) {
    throw new Error("At least one maintenance asset is required.");
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT asset_current_state.asset_id, asset_current_state.operational_status
        FROM asset_current_state
        WHERE asset_current_state.workspace_id = ?
          AND asset_current_state.asset_id IN (${placeholders})
      `,
    )
    .all(workspaceId, ...assetIds) as Array<{ asset_id: string; operational_status: string }>;

  if (rows.length !== assetIds.length) {
    throw new Error("One or more selected assets are no longer available for repair.");
  }

  const retiredRow = rows.find((row) => row.operational_status === "retired");

  if (retiredRow) {
    throw new Error("Retired assets cannot be sent to repair.");
  }
};

const assertAssetsEligibleForUpdate = (db: DatabaseSync, workspaceId: string, rmaCaseId: string, assetIds: string[]) => {
  if (!assetIds.length) {
    throw new Error("At least one maintenance asset is required.");
  }

  const existingRows = db
    .prepare("SELECT asset_id FROM rma_case_assets WHERE rma_case_id = ?")
    .all(rmaCaseId) as Array<{ asset_id: string }>;

  const existingAssetIds = new Set(existingRows.map((row) => row.asset_id));
  const newAssetIds = assetIds.filter((assetId) => !existingAssetIds.has(assetId));

  if (!newAssetIds.length) {
    return;
  }

  assertAssetsEligibleForCreate(db, workspaceId, newAssetIds);
};

const replaceCaseAssets = (db: DatabaseSync, rmaCaseId: string, assetItems: ReturnType<typeof uniqueAssetItems>, now: string) => {
  db.prepare("DELETE FROM rma_case_assets WHERE rma_case_id = ?").run(rmaCaseId);

  const insert = db.prepare(
    `
      INSERT INTO rma_case_assets (
        id,
        rma_case_id,
        asset_id,
        equipment_year,
        issue_summary,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );

  assetItems.forEach((item, index) => {
    insert.run(`${rmaCaseId}-asset-${index + 1}`, rmaCaseId, item.assetId, item.equipmentYear, item.issueSummary, now, now);
  });
};

const normalizeRmaStatus = (status: string): RmaCaseStatus => {
  switch (status) {
    case "Draft":
    case "Ready":
      return "Needs review";
    case "Sent":
      return "Sent to repair";
    case "Closed":
      return "Returned to inventory";
    default:
      return status as RmaCaseStatus;
  }
};

const resolveAssetStateForRmaStatus = (status: RmaCaseStatus) => {
  if (status === "No repair / retired") {
    return {
      conditionStatus: "No repair",
      operationalStatus: "retired",
      custodyStatus: "retired",
      eventType: "asset_retired",
      eventNote: "Marked as no repair from repair case. Removed from available inventory.",
    };
  }

  if (status === "Repaired" || status === "Returned to inventory") {
    return {
      conditionStatus: "Good",
      operationalStatus: "ready",
      custodyStatus: "available",
      eventType: "maintenance_completed",
      eventNote: "Repair completed. Asset returned to available inventory.",
    };
  }

  return {
    conditionStatus: status === "Waiting parts" ? "Waiting parts" : "Needs review",
    operationalStatus: "maintenance",
    custodyStatus: "maintenance",
    eventType: "maintenance_started",
    eventNote: "Repair case keeps this asset out of available inventory.",
  };
};

type RmaStatusMutationContext = {
  commandId: string;
  workspaceId: string;
  rmaCaseId: string;
  actorType: string;
  sourceChannel: string;
};

const applyRmaStatusToAssets = (
  db: DatabaseSync,
  input: RmaStatusMutationContext,
  assetItems: ReturnType<typeof uniqueAssetItems>,
  status: RmaCaseStatus,
  actorUserId: string,
  now: string,
) => {
  const state = resolveAssetStateForRmaStatus(status);
  const updateAssetState = db.prepare(
    `
      UPDATE asset_current_state
      SET
        condition_status = ?,
        operational_status = ?,
        custody_status = ?,
        available_quantity = CASE
          WHEN ? = 'ready' THEN MAX(0, total_quantity - assigned_quantity - checked_out_quantity)
          ELSE 0
        END,
        last_event_id = ?,
        version = version + 1,
        updated_at = ?
      WHERE workspace_id = ?
        AND asset_id = ?
    `,
  );
  const insertEvent = db.prepare(
    `
      INSERT INTO asset_events (
        id,
        workspace_id,
        asset_id,
        assignment_id,
        project_id,
        department_id,
        performed_by_user_id,
        event_type,
        location_id,
        from_location_id,
        to_location_id,
        event_timestamp,
        command_id,
        actor_type,
        source_channel,
        notes,
        metadata_json,
        created_at
      )
      SELECT
        ?,
        asset_current_state.workspace_id,
        asset_current_state.asset_id,
        asset_current_state.active_assignment_id,
        asset_current_state.current_project_id,
        asset_current_state.current_department_id,
        ?,
        ?,
        asset_current_state.current_location_id,
        NULL,
        NULL,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      FROM asset_current_state
      WHERE asset_current_state.workspace_id = ?
        AND asset_current_state.asset_id = ?
    `,
  );
  const insertOutbox = db.prepare(
    `
      INSERT INTO sync_outbox (
        id,
        workspace_id,
        entity_type,
        entity_id,
        event_id,
        operation_type,
        payload_json,
        status,
        attempt_count,
        last_error,
        next_retry_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'asset_event', ?, ?, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
    `,
  );

  assetItems.forEach((item, index) => {
    const eventId = `event-${input.commandId}-rma-${index + 1}`;
    const metadataJson = JSON.stringify({
      rmaCaseId: input.rmaCaseId,
      rmaStatus: status,
      issueSummary: item.issueSummary,
    });

    insertEvent.run(
      eventId,
      actorUserId,
      state.eventType,
      now,
      input.commandId,
      input.actorType,
      input.sourceChannel,
      state.eventNote,
      metadataJson,
      now,
      input.workspaceId,
      item.assetId,
    );

    updateAssetState.run(
      state.conditionStatus,
      state.operationalStatus,
      state.custodyStatus,
      state.operationalStatus,
      eventId,
      now,
      input.workspaceId,
      item.assetId,
    );

    insertOutbox.run(`outbox-${eventId}`, input.workspaceId, item.assetId, eventId, metadataJson, now, now);
  });
};

export const createRmaMutationService = (db: DatabaseSync) => ({
  createRmaCase(input: CreateRmaCaseCommand): RmaCaseMutationResult {
    const actor = resolveAuthorizedActor(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      requiredPermission: "rma.create",
      actionLabel: "create RMAs",
    });
    const workspaceId = input.workspaceId;
    const now = new Date().toISOString();
    const assetItems = uniqueAssetItems(input.assetItems);
    const manufacturer = loadManufacturer(db, workspaceId, ensureValue(input.manufacturerId, "Manufacturer"));
    const supportEmail = optionalValue(input.supportEmail) ?? optionalValue(manufacturer.support_email) ?? "";
    const title = ensureValue(input.title, "RMA title");
    const problemSummary = ensureValue(input.problemSummary, "Problem summary");

    assertAssetsEligibleForCreate(
      db,
      workspaceId,
      assetItems.map((item) => item.assetId),
    );

    const rmaCaseId = `rma-${Date.now().toString(36)}`;

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO rma_cases (
            id,
            workspace_id,
            manufacturer_id,
            title,
            support_email,
            problem_summary,
            notes,
            status,
            created_by_user_id,
            created_at,
            updated_at,
            sent_at,
            closed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Needs review', ?, ?, ?, NULL, NULL)
        `,
      ).run(rmaCaseId, workspaceId, manufacturer.id, title, supportEmail, problemSummary, optionalValue(input.notes), actor.actorUserId, now, now);

      replaceCaseAssets(db, rmaCaseId, assetItems, now);
      applyRmaStatusToAssets(
        db,
        {
          commandId: input.commandId,
          workspaceId,
          rmaCaseId,
          actorType: input.actorType,
          sourceChannel: input.sourceChannel,
        },
        assetItems,
        "Needs review",
        actor.actorUserId,
        now,
      );

      enqueueOperationalSnapshotOutbox(db, {
        workspaceId,
        entityType: "rma_case",
        entityId: rmaCaseId,
        updatedAt: now,
        payload: {
          rmaCaseId,
          status: "Needs review",
          assetIds: assetItems.map((item) => item.assetId),
        },
      });

      db.exec("COMMIT");
      return {
        rmaCaseId,
        summary: `${assetItems.length} asset${assetItems.length === 1 ? "" : "s"} prepared for RMA draft.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  updateRmaCase(input: UpdateRmaCaseCommand): RmaCaseMutationResult {
    const actor = resolveAuthorizedActor(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      requiredPermission: "rma.create",
      actionLabel: "update RMAs",
    });
    const workspaceId = input.workspaceId;
    const now = new Date().toISOString();
    const assetItems = uniqueAssetItems(input.assetItems);
    const manufacturer = loadManufacturer(db, workspaceId, ensureValue(input.manufacturerId, "Manufacturer"));
    const supportEmail = optionalValue(input.supportEmail) ?? optionalValue(manufacturer.support_email) ?? "";
    const title = ensureValue(input.title, "RMA title");
    const problemSummary = ensureValue(input.problemSummary, "Problem summary");
    const status = normalizeRmaStatus(ensureValue(input.status, "RMA status"));

    assertAssetsEligibleForUpdate(
      db,
      workspaceId,
      input.rmaCaseId,
      assetItems.map((item) => item.assetId),
    );

    const previous = db
      .prepare("SELECT status, sent_at, closed_at FROM rma_cases WHERE id = ? AND workspace_id = ? LIMIT 1")
      .get(input.rmaCaseId, workspaceId) as { status: string; sent_at: string | null; closed_at: string | null } | undefined;

    if (!previous) {
      throw new Error("RMA case not found.");
    }

    const previousStatus = normalizeRmaStatus(previous.status);
    const nextSentAt = status === "Sent to repair" || status === "Waiting parts" ? previous.sent_at ?? now : previous.sent_at;
    const isTerminalStatus = status === "Repaired" || status === "No repair / retired" || status === "Returned to inventory";
    const nextClosedAt = isTerminalStatus ? previous.closed_at ?? now : null;

    db.exec("BEGIN");

    try {
      const result = db.prepare(
        `
          UPDATE rma_cases
          SET manufacturer_id = ?,
              title = ?,
              support_email = ?,
              problem_summary = ?,
              notes = ?,
              status = ?,
              updated_at = ?,
              sent_at = ?,
              closed_at = ?
          WHERE id = ?
            AND workspace_id = ?
        `,
      ).run(
        manufacturer.id,
        title,
        supportEmail,
        problemSummary,
        optionalValue(input.notes),
        status,
        now,
        nextSentAt,
        nextClosedAt,
        input.rmaCaseId,
        workspaceId,
      );

      if (!result.changes) {
        throw new Error("RMA case not found.");
      }

      replaceCaseAssets(db, input.rmaCaseId, assetItems, now);

      if (status !== previousStatus) {
        applyRmaStatusToAssets(db, input, assetItems, status, actor.actorUserId, now);
      }

      enqueueOperationalSnapshotOutbox(db, {
        workspaceId,
        entityType: "rma_case",
        entityId: input.rmaCaseId,
        updatedAt: now,
        payload: {
          rmaCaseId: input.rmaCaseId,
          status,
          assetIds: assetItems.map((item) => item.assetId),
        },
      });

      db.exec("COMMIT");
      return {
        rmaCaseId: input.rmaCaseId,
        summary: `RMA case updated to ${status.toLowerCase()}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
});

export type RmaMutationService = ReturnType<typeof createRmaMutationService>;
