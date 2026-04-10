import type { DatabaseSync } from "node:sqlite";

import type {
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
} from "@contracts";

const defaultActorUserId = "user-ops";

type PackingAssetRow = {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  current_location_id: string | null;
  default_location_id: string | null;
  current_project_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  condition_status: string;
  operational_status: string;
  custody_status: string;
  version: number;
  quantity: number;
};

type PackingSlipRow = {
  id: string;
  project_id: string;
  department_id: string | null;
  responsible_user_id: string | null;
  status: string;
  return_due_date: string | null;
};

type PendingSlipItemRow = {
  item_id: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  current_location_id: string | null;
  default_location_id: string | null;
  current_project_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  condition_status: string;
  version: number;
  condition_out: string | null;
};

type NamedEntityRow = {
  id: string;
  name: string;
};

type SlipCountRow = {
  item_count: number;
  returned_count: number | null;
};

const uniqueValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const createPlaceholders = (values: string[]) => values.map(() => "?").join(", ");

const loadNamedEntities = (
  db: DatabaseSync,
  tableName: "projects" | "departments" | "locations",
  values: string[],
) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, name
        FROM ${tableName}
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as NamedEntityRow[];

  return new Map(rows.map((row) => [row.id, row.name]));
};

const loadUserEntities = (db: DatabaseSync, values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, full_name AS name
        FROM users
        WHERE id IN (${createPlaceholders(values)})
      `,
    )
    .all(...values) as NamedEntityRow[];

  return new Map(rows.map((row) => [row.id, row.name]));
};

const ensureEntityExists = (value: string | undefined, label: string, map: Map<string, string>) => {
  if (!value) {
    return;
  }

  if (!map.has(value)) {
    throw new Error(`${label} not found.`);
  }
};

const parsePackingSequence = (value: string) => {
  const match = value.match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
};

const getNextPackingSequence = (db: DatabaseSync) => {
  const rows = db.prepare("SELECT id FROM packing_slips").all() as Array<{ id: string }>;
  const currentMax = rows.reduce((highest, row) => Math.max(highest, parsePackingSequence(row.id)), 0);
  return currentMax + 1;
};

const buildPackingIdentifiers = (sequence: number) => {
  const serial = String(sequence).padStart(4, "0");

  return {
    packingSlipId: `packing-${serial}`,
    slipNumber: `PS-${serial}`,
  };
};

const buildIssueSummary = (slipNumber: string, itemCount: number) => {
  const itemLabel = itemCount === 1 ? "asset" : "assets";
  return `${slipNumber} issued with ${itemCount} ${itemLabel}.`;
};

const buildReturnSummary = (slipNumber: string, itemCount: number, slipStatus: string) => {
  const itemLabel = itemCount === 1 ? "item" : "items";

  if (slipStatus === "Closed") {
    return `${itemCount} ${itemLabel} returned on ${slipNumber}. Slip closed successfully.`;
  }

  return `${itemCount} ${itemLabel} returned on ${slipNumber}. Slip remains open with pending items.`;
};

const resolveSlipStatus = (itemCount: number, returnedCount: number) => {
  if (returnedCount >= itemCount) {
    return "Closed";
  }

  if (returnedCount > 0) {
    return "Partial return";
  }

  return "Issued";
};

export const createPackingMutationService = (db: DatabaseSync) => ({
  createPackingSlip(input: CreatePackingSlipCommand): CreatePackingSlipResult {
    const assetIds = uniqueValues(input.assetIds);

    if (!assetIds.length) {
      throw new Error("Select at least one asset before issuing a packing slip.");
    }

    if (!input.projectId?.trim()) {
      throw new Error("Choose a project before issuing a packing slip.");
    }

    const existingReceipt = db
      .prepare(
        `
          SELECT outcome_status
          FROM command_receipts
          WHERE command_id = ?
          LIMIT 1
        `,
      )
      .get(input.commandId) as { outcome_status: string } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        packingSlipId: `packing-${input.commandId}`,
        slipNumber: "PS-repeat",
        processedAssetIds: assetIds,
        repeated: true,
        summary: "This packing command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error("This command id already failed once. Generate a new packing action and retry.");
    }

    const projectMap = loadNamedEntities(db, "projects", uniqueValues([input.projectId]));
    const departmentMap = loadNamedEntities(db, "departments", uniqueValues([input.departmentId]));
    const userMap = loadUserEntities(db, uniqueValues([input.responsibleUserId, defaultActorUserId]));

    ensureEntityExists(input.projectId, "Project", projectMap);
    ensureEntityExists(input.departmentId, "Department", departmentMap);
    ensureEntityExists(input.responsibleUserId, "Responsible user", userMap);
    ensureEntityExists(defaultActorUserId, "Actor user", userMap);

    const assetRows = db
      .prepare(
        `
          SELECT
            asset_current_state.asset_id,
            assets.name AS asset_name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code,
            asset_current_state.current_location_id,
            assets.default_location_id,
            asset_current_state.current_project_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.condition_status,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.version,
            COALESCE(legacy_rentman_items.current_quantity, 1) AS quantity
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          WHERE asset_current_state.workspace_id = ?
            AND asset_current_state.asset_id IN (${createPlaceholders(assetIds)})
        `,
      )
      .all(input.workspaceId, ...assetIds) as PackingAssetRow[];

    if (assetRows.length !== assetIds.length) {
      throw new Error("One or more selected assets no longer exist in the live registry.");
    }

    const maintenanceAsset = assetRows.find((row) => row.operational_status === "maintenance");

    if (maintenanceAsset) {
      throw new Error(`${maintenanceAsset.asset_name} is in maintenance and cannot be packed out right now.`);
    }

    const checkedOutAsset = assetRows.find((row) => row.custody_status === "checked_out");

    if (checkedOutAsset) {
      throw new Error(`${checkedOutAsset.asset_name} is already checked out on another active flow.`);
    }

    const conflictingProjectAsset = assetRows.find(
      (row) => row.custody_status === "assigned" && row.current_project_id && row.current_project_id !== input.projectId,
    );

    if (conflictingProjectAsset) {
      throw new Error(
        `${conflictingProjectAsset.asset_name} is still assigned to another project. Reassign it before issuing this slip.`,
      );
    }

    const sequence = getNextPackingSequence(db);
    const { packingSlipId, slipNumber } = buildPackingIdentifiers(sequence);
    const now = new Date().toISOString();
    const nextDepartmentId = input.departmentId?.trim() || null;
    const nextResponsibleUserId = input.responsibleUserId?.trim() || null;
    const nextReturnDueAt = input.returnDueAt?.trim() || null;

    const insertReceipt = db.prepare(
      `
        INSERT OR REPLACE INTO command_receipts (
          command_id,
          workspace_id,
          actor_user_id,
          actor_type,
          source_channel,
          executed_at,
          outcome_status,
          error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO packing_slips (
            id,
            workspace_id,
            project_id,
            department_id,
            prepared_by_user_id,
            approved_by_user_id,
            responsible_user_id,
            status,
            issue_date,
            return_due_date,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, NULL, ?, 'Issued', ?, ?, ?, ?, ?)
        `,
      ).run(
        packingSlipId,
        input.workspaceId,
        input.projectId,
        nextDepartmentId,
        defaultActorUserId,
        nextResponsibleUserId,
        now,
        nextReturnDueAt,
        input.notes?.trim() || null,
        now,
        now,
      );

      const insertPackingItemStatement = db.prepare(
        `
          INSERT INTO packing_slip_items (
            id,
            packing_slip_id,
            asset_id,
            quantity,
            condition_out,
            condition_in,
            returned_at,
            notes
          )
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
        `,
      );
      const insertAssignmentStatement = db.prepare(
        `
          INSERT INTO asset_assignments (
            id,
            workspace_id,
            asset_id,
            project_id,
            department_id,
            assigned_to_user_id,
            assigned_by_user_id,
            source_location_id,
            target_location_id,
            assignment_status,
            checked_out_at,
            expected_return_at,
            returned_at,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_out', ?, ?, NULL, ?, ?, ?)
        `,
      );
      const updateAssignmentStatement = db.prepare(
        `
          UPDATE asset_assignments
          SET
            project_id = ?,
            department_id = ?,
            assigned_to_user_id = ?,
            target_location_id = ?,
            assignment_status = 'checked_out',
            checked_out_at = ?,
            expected_return_at = ?,
            notes = ?,
            updated_at = ?
          WHERE id = ?
        `,
      );
      const insertEventStatement = db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'check_out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      const updateCurrentStateStatement = db.prepare(
        `
          UPDATE asset_current_state
          SET
            current_location_id = ?,
            current_project_id = ?,
            current_department_id = ?,
            current_responsible_user_id = ?,
            active_assignment_id = ?,
            custody_status = 'checked_out',
            last_event_id = ?,
            version = ?,
            updated_at = ?
          WHERE asset_id = ?
        `,
      );
      const insertAssetOutboxStatement = db.prepare(
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
      const insertPackingOutboxStatement = db.prepare(
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
          VALUES (?, ?, 'packing_slip', ?, NULL, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
        `,
      );

      const processedAssetIds: string[] = [];

      assetRows.forEach((row, index) => {
        const assignmentId = row.active_assignment_id ?? `assign-${input.commandId}-${index}`;
        const nextLocationId = row.current_location_id;
        const responsibleUserId = nextResponsibleUserId ?? row.current_responsible_user_id;
        const departmentId = nextDepartmentId ?? row.current_department_id;
        const itemId = `packing-item-${input.commandId}-${index}`;
        const eventId = `event-${input.commandId}-${index}`;
        const metadataJson = JSON.stringify({
          packingSlipId,
          slipNumber,
          quantity: row.quantity,
          previous: {
            projectId: row.current_project_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            custodyStatus: row.custody_status,
          },
          next: {
            projectId: input.projectId,
            departmentId,
            responsibleUserId,
            custodyStatus: "checked_out",
          },
          returnDueAt: nextReturnDueAt,
        });
        const note =
          input.notes?.trim() ||
          `Issued ${row.asset_name} on ${slipNumber} for ${projectMap.get(input.projectId)}${
            responsibleUserId ? ` · ${userMap.get(responsibleUserId)}` : ""
          }.`;

        insertPackingItemStatement.run(itemId, packingSlipId, row.asset_id, row.quantity, row.condition_status, note);

        if (row.active_assignment_id) {
          updateAssignmentStatement.run(
            input.projectId,
            departmentId,
            responsibleUserId,
            nextLocationId,
            now,
            nextReturnDueAt,
            note,
            now,
            row.active_assignment_id,
          );
        } else {
          insertAssignmentStatement.run(
            assignmentId,
            input.workspaceId,
            row.asset_id,
            input.projectId,
            departmentId,
            responsibleUserId,
            defaultActorUserId,
            row.current_location_id,
            nextLocationId,
            now,
            nextReturnDueAt,
            note,
            now,
            now,
          );
        }

        insertEventStatement.run(
          eventId,
          input.workspaceId,
          row.asset_id,
          assignmentId,
          input.projectId,
          departmentId,
          defaultActorUserId,
          nextLocationId,
          row.current_location_id,
          nextLocationId,
          now,
          input.commandId,
          input.actorType,
          input.sourceChannel,
          note,
          metadataJson,
          now,
        );

        updateCurrentStateStatement.run(
          nextLocationId,
          input.projectId,
          departmentId,
          responsibleUserId,
          assignmentId,
          eventId,
          row.version + 1,
          now,
          row.asset_id,
        );

        insertAssetOutboxStatement.run(`outbox-${eventId}`, input.workspaceId, row.asset_id, eventId, metadataJson, now, now);
        processedAssetIds.push(row.asset_id);
      });

      insertPackingOutboxStatement.run(
        `outbox-${packingSlipId}`,
        input.workspaceId,
        packingSlipId,
        JSON.stringify({
          packingSlipId,
          slipNumber,
          projectId: input.projectId,
          departmentId: nextDepartmentId,
          responsibleUserId: nextResponsibleUserId,
          status: "Issued",
          assetIds: processedAssetIds,
        }),
        now,
        now,
      );

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        packingSlipId,
        slipNumber,
        processedAssetIds,
        repeated: false,
        summary: buildIssueSummary(slipNumber, processedAssetIds.length),
      };
    } catch (error) {
      db.exec("ROLLBACK");

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Unknown packing issue error",
      );

      throw error;
    }
  },

  returnPackingSlipItems(input: ReturnPackingSlipItemsCommand): ReturnPackingSlipItemsResult {
    const selectedAssetIds = uniqueValues(input.assetIds ?? []);
    const existingReceipt = db
      .prepare(
        `
          SELECT outcome_status
          FROM command_receipts
          WHERE command_id = ?
          LIMIT 1
        `,
      )
      .get(input.commandId) as { outcome_status: string } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        packingSlipId: input.packingSlipId,
        processedAssetIds: selectedAssetIds,
        repeated: true,
        slipStatus: "Closed",
        summary: "This return command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error("This command id already failed once. Generate a new return action and retry.");
    }

    const slip = db
      .prepare(
        `
          SELECT id, project_id, department_id, responsible_user_id, status, return_due_date
          FROM packing_slips
          WHERE id = ?
            AND workspace_id = ?
          LIMIT 1
        `,
      )
      .get(input.packingSlipId, input.workspaceId) as PackingSlipRow | undefined;

    if (!slip) {
      throw new Error("Packing slip not found in the local registry.");
    }

    const actorUserMap = loadUserEntities(db, [defaultActorUserId]);
    ensureEntityExists(defaultActorUserId, "Actor user", actorUserMap);

    const filterSql = selectedAssetIds.length
      ? `AND packing_slip_items.asset_id IN (${createPlaceholders(selectedAssetIds)})`
      : "";
    const pendingRows = db
      .prepare(
        `
          SELECT
            packing_slip_items.id AS item_id,
            assets.id AS asset_id,
            assets.name AS asset_name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code,
            asset_current_state.current_location_id,
            assets.default_location_id,
            asset_current_state.current_project_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.condition_status,
            asset_current_state.version,
            packing_slip_items.condition_out
          FROM packing_slip_items
          JOIN assets ON assets.id = packing_slip_items.asset_id
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          WHERE packing_slip_items.packing_slip_id = ?
            AND packing_slip_items.returned_at IS NULL
            ${filterSql}
          ORDER BY assets.name
        `,
      )
      .all(input.packingSlipId, ...selectedAssetIds) as PendingSlipItemRow[];

    if (!pendingRows.length) {
      throw new Error("All selected packing slip items are already returned.");
    }

    if (selectedAssetIds.length && pendingRows.length !== selectedAssetIds.length) {
      throw new Error("Some selected assets are no longer pending on this packing slip.");
    }

    const now = new Date().toISOString();
    const conditionIn = input.conditionIn?.trim();
    const note = input.notes?.trim() || null;
    const slipNumber = input.packingSlipId.replace("packing-", "PS-");

    const insertReceipt = db.prepare(
      `
        INSERT OR REPLACE INTO command_receipts (
          command_id,
          workspace_id,
          actor_user_id,
          actor_type,
          source_channel,
          executed_at,
          outcome_status,
          error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    db.exec("BEGIN");

    try {
      const updatePackingItemStatement = db.prepare(
        `
          UPDATE packing_slip_items
          SET
            condition_in = ?,
            returned_at = ?,
            notes = COALESCE(?, notes)
          WHERE id = ?
        `,
      );
      const updateAssignmentStatement = db.prepare(
        `
          UPDATE asset_assignments
          SET
            assignment_status = 'returned',
            returned_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
      );
      const insertEventStatement = db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'check_in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      const updateCurrentStateStatement = db.prepare(
        `
          UPDATE asset_current_state
          SET
            current_location_id = ?,
            current_project_id = NULL,
            current_department_id = NULL,
            current_responsible_user_id = NULL,
            active_assignment_id = NULL,
            condition_status = ?,
            custody_status = 'available',
            last_event_id = ?,
            version = ?,
            updated_at = ?
          WHERE asset_id = ?
        `,
      );
      const updateSlipStatement = db.prepare(
        `
          UPDATE packing_slips
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
      );
      const insertOutboxStatement = db.prepare(
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
          VALUES (?, ?, ?, ?, ?, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
        `,
      );

      const processedAssetIds: string[] = [];

      pendingRows.forEach((row, index) => {
        const nextLocationId = row.default_location_id ?? row.current_location_id;
        const nextCondition = conditionIn || row.condition_out || row.condition_status;
        const eventId = `event-${input.commandId}-${index}`;
        const metadataJson = JSON.stringify({
          packingSlipId: input.packingSlipId,
          slipNumber,
          previous: {
            locationId: row.current_location_id,
            projectId: row.current_project_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            assignmentId: row.active_assignment_id,
          },
          next: {
            locationId: nextLocationId,
            conditionStatus: nextCondition,
            custodyStatus: "available",
          },
        });
        const rowNote = note || `Returned ${row.asset_name} from ${slipNumber}.`;

        updatePackingItemStatement.run(nextCondition, now, rowNote, row.item_id);

        if (row.active_assignment_id) {
          updateAssignmentStatement.run(now, now, row.active_assignment_id);
        }

        insertEventStatement.run(
          eventId,
          input.workspaceId,
          row.asset_id,
          row.active_assignment_id,
          slip.project_id,
          slip.department_id,
          defaultActorUserId,
          nextLocationId,
          row.current_location_id,
          nextLocationId,
          now,
          input.commandId,
          input.actorType,
          input.sourceChannel,
          rowNote,
          metadataJson,
          now,
        );

        updateCurrentStateStatement.run(
          nextLocationId,
          nextCondition,
          eventId,
          row.version + 1,
          now,
          row.asset_id,
        );

        insertOutboxStatement.run(`outbox-${eventId}`, input.workspaceId, "asset_event", row.asset_id, eventId, metadataJson, now, now);
        processedAssetIds.push(row.asset_id);
      });

      const slipCounts = db
        .prepare(
          `
            SELECT
              COUNT(*) AS item_count,
              SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned_count
            FROM packing_slip_items
            WHERE packing_slip_id = ?
          `,
        )
        .get(input.packingSlipId) as SlipCountRow;

      const slipStatus = resolveSlipStatus(slipCounts.item_count, slipCounts.returned_count ?? 0);
      updateSlipStatement.run(slipStatus, now, input.packingSlipId);

      insertOutboxStatement.run(
        `outbox-${input.packingSlipId}-${input.commandId}`,
        input.workspaceId,
        "packing_slip",
        input.packingSlipId,
        null,
        JSON.stringify({
          packingSlipId: input.packingSlipId,
          status: slipStatus,
          returnedAssetIds: processedAssetIds,
        }),
        now,
        now,
      );

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "success",
        null,
      );

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        packingSlipId: input.packingSlipId,
        processedAssetIds,
        repeated: false,
        slipStatus,
        summary: buildReturnSummary(slipNumber, processedAssetIds.length, slipStatus),
      };
    } catch (error) {
      db.exec("ROLLBACK");

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        "failed",
        error instanceof Error ? error.message : "Unknown packing return error",
      );

      throw error;
    }
  },
});
