import type { DatabaseSync } from "node:sqlite";

import type { AssignMoveAssetsInput, AssignMoveAssetsResult } from "@contracts";

const defaultActorUserId = "user-ops";

type AssetStateRow = {
  asset_id: string;
  asset_name: string;
  current_location_id: string | null;
  current_project_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  operational_status: string;
  custody_status: string;
  version: number;
};

type NamedEntityRow = {
  id: string;
  name: string;
};

const uniqueValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const createPlaceholders = (values: string[]) => values.map(() => "?").join(", ");

const loadNamedEntities = (
  db: DatabaseSync,
  tableName: "projects" | "departments" | "locations",
  values: string[],
): Map<string, string> => {
  if (!values.length) {
    return new Map();
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

const buildAssignmentNote = (
  assetName: string,
  projectName: string | undefined,
  responsibleName: string | undefined,
  locationName: string | undefined,
) => {
  const summary = [projectName, responsibleName, locationName].filter(Boolean).join(" · ");
  return summary ? `Assigned ${assetName} to ${summary}.` : `Assigned ${assetName}.`;
};

const buildMoveNote = (assetName: string, fromLocationName: string | undefined, toLocationName: string | undefined) => {
  if (fromLocationName && toLocationName) {
    return `Moved ${assetName} from ${fromLocationName} to ${toLocationName}.`;
  }

  if (toLocationName) {
    return `Moved ${assetName} to ${toLocationName}.`;
  }

  return `Moved ${assetName}.`;
};

const summarizeResult = (eventType: "assigned" | "moved", processedCount: number) => {
  const assetLabel = processedCount === 1 ? "asset" : "assets";
  return eventType === "assigned"
    ? `${processedCount} ${assetLabel} updated through assignment flow.`
    : `${processedCount} ${assetLabel} moved successfully.`;
};

export const createAssetMutationService = (db: DatabaseSync) => ({
  assignMoveAssets(input: AssignMoveAssetsInput): AssignMoveAssetsResult {
    const assetIds = uniqueValues(input.assetIds);

    if (!assetIds.length) {
      throw new Error("Select at least one asset before running assign or move.");
    }

    if (input.mode === "move" && !input.targetLocationId) {
      throw new Error("Choose a destination location before moving assets.");
    }

    if (input.mode === "assign" && !input.projectId && !input.departmentId && !input.assignedToUserId) {
      throw new Error("Assignment needs at least a project, department or responsible user.");
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
        eventType: input.mode === "assign" ? "assigned" : "moved",
        processedAssetIds: assetIds,
        repeated: true,
        summary: "This command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error("This command id already failed once. Generate a new action and retry.");
    }

    const projectMap = loadNamedEntities(db, "projects", uniqueValues([input.projectId]));
    const departmentMap = loadNamedEntities(db, "departments", uniqueValues([input.departmentId]));
    const locationMap = loadNamedEntities(db, "locations", uniqueValues([input.targetLocationId]));
    const userMap = loadUserEntities(db, uniqueValues([input.assignedToUserId, defaultActorUserId]));

    ensureEntityExists(input.projectId, "Project", projectMap);
    ensureEntityExists(input.departmentId, "Department", departmentMap);
    ensureEntityExists(input.targetLocationId, "Target location", locationMap);
    ensureEntityExists(input.assignedToUserId, "Responsible user", userMap);
    ensureEntityExists(defaultActorUserId, "Actor user", userMap);

    const assetStateRows = db
      .prepare(
        `
          SELECT
            asset_current_state.asset_id,
            assets.name AS asset_name,
            asset_current_state.current_location_id,
            asset_current_state.current_project_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.version
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          WHERE asset_current_state.workspace_id = ?
            AND asset_current_state.asset_id IN (${createPlaceholders(assetIds)})
        `,
      )
      .all(input.workspaceId, ...assetIds) as AssetStateRow[];

    if (assetStateRows.length !== assetIds.length) {
      throw new Error("One or more selected assets no longer exist in the local registry.");
    }

    const currentLocationIds = uniqueValues(assetStateRows.map((row) => row.current_location_id));
    const currentLocationMap = loadNamedEntities(db, "locations", currentLocationIds);
    const processedRows =
      input.mode === "move"
        ? assetStateRows.filter((row) => row.current_location_id !== input.targetLocationId)
        : assetStateRows.filter((row) => {
            const nextProjectId = input.projectId ?? row.current_project_id;
            const nextDepartmentId = input.departmentId ?? row.current_department_id;
            const nextResponsibleUserId = input.assignedToUserId ?? row.current_responsible_user_id;
            const nextLocationId = input.targetLocationId ?? row.current_location_id;

            return (
              row.active_assignment_id === null ||
              row.custody_status !== "assigned" ||
              row.current_project_id !== nextProjectId ||
              row.current_department_id !== nextDepartmentId ||
              row.current_responsible_user_id !== nextResponsibleUserId ||
              row.current_location_id !== nextLocationId ||
              Boolean(input.expectedReturnAt)
            );
          });

    if (!processedRows.length) {
      throw new Error("The selected assets already match the requested assignment or movement.");
    }

    if (input.mode === "assign") {
      const maintenanceAsset = processedRows.find((row) => row.operational_status === "maintenance");

      if (maintenanceAsset) {
        throw new Error(`${maintenanceAsset.asset_name} is in maintenance and cannot be assigned right now.`);
      }
    }

    const now = new Date().toISOString();
    const eventType = input.mode === "assign" ? "assigned" : "moved";
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
      const closeAssignmentStatement = db.prepare(
        `
          UPDATE asset_assignments
          SET assignment_status = 'reassigned', updated_at = ?
          WHERE id = ?
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `,
      );
      const updateAssignmentLocationStatement = db.prepare(
        `
          UPDATE asset_assignments
          SET target_location_id = ?, updated_at = ?
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            custody_status = ?,
            last_event_id = ?,
            version = ?,
            updated_at = ?
          WHERE asset_id = ?
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
          VALUES (?, ?, 'asset_event', ?, ?, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
        `,
      );

      const processedAssetIds: string[] = [];

      processedRows.forEach((row, index) => {
        const targetLocationId = input.targetLocationId ?? row.current_location_id;
        const nextProjectId = input.mode === "assign" ? input.projectId ?? row.current_project_id : row.current_project_id;
        const nextDepartmentId = input.mode === "assign" ? input.departmentId ?? row.current_department_id : row.current_department_id;
        const nextResponsibleUserId =
          input.mode === "assign" ? input.assignedToUserId ?? row.current_responsible_user_id : row.current_responsible_user_id;
        let nextAssignmentId = row.active_assignment_id;

        if (input.mode === "assign") {
          if (row.active_assignment_id) {
            closeAssignmentStatement.run(now, row.active_assignment_id);
          }

          nextAssignmentId = `assign-${input.commandId}-${index}`;

          insertAssignmentStatement.run(
            nextAssignmentId,
            input.workspaceId,
            row.asset_id,
            nextProjectId,
            nextDepartmentId,
            nextResponsibleUserId,
            defaultActorUserId,
            row.current_location_id,
            targetLocationId,
            "assigned",
            now,
            input.expectedReturnAt?.trim() || null,
            input.notes?.trim() || null,
            now,
            now,
          );
        } else if (row.active_assignment_id && targetLocationId !== row.current_location_id) {
          updateAssignmentLocationStatement.run(targetLocationId, now, row.active_assignment_id);
        }

        const eventId = `event-${input.commandId}-${index}`;
        const projectName = nextProjectId ? projectMap.get(nextProjectId) : undefined;
        const departmentName = nextDepartmentId ? departmentMap.get(nextDepartmentId) : undefined;
        const targetLocationName = targetLocationId ? locationMap.get(targetLocationId) ?? currentLocationMap.get(targetLocationId) : undefined;
        const sourceLocationName = row.current_location_id ? currentLocationMap.get(row.current_location_id) : undefined;
        const responsibleName = nextResponsibleUserId ? userMap.get(nextResponsibleUserId) : undefined;
        const note =
          input.notes?.trim() ||
          (input.mode === "assign"
            ? buildAssignmentNote(row.asset_name, projectName ?? departmentName, responsibleName, targetLocationName)
            : buildMoveNote(row.asset_name, sourceLocationName, targetLocationName));

        const metadataJson = JSON.stringify({
          mode: input.mode,
          previous: {
            locationId: row.current_location_id,
            projectId: row.current_project_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            activeAssignmentId: row.active_assignment_id,
            custodyStatus: row.custody_status,
          },
          next: {
            locationId: targetLocationId,
            projectId: nextProjectId,
            departmentId: nextDepartmentId,
            responsibleUserId: nextResponsibleUserId,
            activeAssignmentId: nextAssignmentId,
            custodyStatus: input.mode === "assign" ? "assigned" : row.custody_status,
          },
          expectedReturnAt: input.expectedReturnAt ?? null,
        });

        insertEventStatement.run(
          eventId,
          input.workspaceId,
          row.asset_id,
          nextAssignmentId,
          nextProjectId,
          nextDepartmentId,
          defaultActorUserId,
          eventType,
          targetLocationId,
          row.current_location_id,
          targetLocationId,
          now,
          input.commandId,
          input.actorType,
          input.sourceChannel,
          note,
          metadataJson,
          now,
        );

        updateCurrentStateStatement.run(
          targetLocationId,
          nextProjectId,
          nextDepartmentId,
          nextResponsibleUserId,
          nextAssignmentId,
          input.mode === "assign" ? "assigned" : row.custody_status,
          eventId,
          row.version + 1,
          now,
          row.asset_id,
        );

        insertOutboxStatement.run(
          `outbox-${eventId}`,
          input.workspaceId,
          row.asset_id,
          eventId,
          metadataJson,
          now,
          now,
        );

        processedAssetIds.push(row.asset_id);
      });

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
        eventType,
        processedAssetIds,
        repeated: false,
        summary: summarizeResult(eventType, processedAssetIds.length),
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
        error instanceof Error ? error.message : "Unknown asset mutation error",
      );

      throw error;
    }
  },
});
