import type { DatabaseSync } from "node:sqlite";

import type {
  ArchiveAssetCommand,
  AssetEditorMutationResult,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  CreateAssetCommand,
  UpdateAssetCommand,
} from "@contracts";

import { createCodeGenerationService } from "./codeGenerationService";
import { assertProjectUnitSupportsOperationalFlow } from "./projectScheduling";

const defaultActorUserId = "user-ops";

type AssetStateRow = {
  asset_id: string;
  asset_name: string;
  current_location_id: string | null;
  current_project_id: string | null;
  project_unit_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  operational_status: string;
  custody_status: string;
  total_quantity: number;
  available_quantity: number;
  assigned_quantity: number;
  checked_out_quantity: number;
  version: number;
};

type NamedEntityRow = {
  id: string;
  name: string;
};

type ProjectEntityRow = {
  id: string;
  name: string;
  status: string;
};

type CategoryEntityRow = {
  id: string;
  name: string;
};

type ProjectUnitEntityRow = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  status_source: string | null;
  start_date: string | null;
  end_date: string | null;
};

type KitMembershipRow = {
  asset_id: string;
  kit_id: string;
  kit_code: string;
  kit_name: string;
};

const uniqueValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const createPlaceholders = (values: string[]) => values.map(() => "?").join(", ");

const loadNamedEntities = (
  db: DatabaseSync,
  tableName: "projects" | "departments" | "locations",
  workspaceId: string,
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
        WHERE workspace_id = ?
          AND id IN (${createPlaceholders(values)})
      `,
    )
    .all(workspaceId, ...values) as NamedEntityRow[];

  return new Map(rows.map((row) => [row.id, row.name]));
};

const loadProjectEntities = (db: DatabaseSync, workspaceId: string, values: string[]) => {
  if (!values.length) {
    return new Map<string, ProjectEntityRow>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, name, status
        FROM projects
        WHERE workspace_id = ?
          AND id IN (${createPlaceholders(values)})
      `,
    )
    .all(workspaceId, ...values) as ProjectEntityRow[];

  return new Map(rows.map((row) => [row.id, row]));
};

const loadCategoryEntities = (db: DatabaseSync, workspaceId: string, values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const rows = db
    .prepare(
      `
        SELECT id, name
        FROM asset_categories
        WHERE workspace_id = ?
          AND id IN (${createPlaceholders(values)})
      `,
    )
    .all(workspaceId, ...values) as CategoryEntityRow[];

  return new Map(rows.map((row) => [row.id, row.name]));
};

const loadProjectUnitEntities = (db: DatabaseSync, workspaceId: string, values: string[]) => {
  if (!values.length) {
    return new Map<string, ProjectUnitEntityRow>();
  }

  const rows = db
    .prepare(
      `
        SELECT project_units.id, project_units.project_id, project_units.name, project_units.status, project_units.status_source, project_units.start_date, project_units.end_date
        FROM project_units
        JOIN projects ON projects.id = project_units.project_id
        WHERE projects.workspace_id = ?
          AND project_units.id IN (${createPlaceholders(values)})
      `,
    )
    .all(workspaceId, ...values) as ProjectUnitEntityRow[];

  return new Map(rows.map((row) => [row.id, row]));
};

const loadUserEntities = (db: DatabaseSync, workspaceId: string, values: string[]) => {
  if (!values.length) {
    return new Map<string, string>();
  }

  const rows = db
    .prepare(
      `
        SELECT users.id, users.full_name AS name
        FROM users
        JOIN workspace_memberships ON workspace_memberships.user_id = users.id
        WHERE workspace_memberships.workspace_id = ?
          AND workspace_memberships.status = 'active'
          AND users.is_active = 1
          AND users.id IN (${createPlaceholders(values)})
      `,
    )
    .all(workspaceId, ...values) as NamedEntityRow[];

  return new Map(rows.map((row) => [row.id, row.name]));
};

const loadKitMemberships = (db: DatabaseSync, assetIds: string[]) => {
  if (!assetIds.length) {
    return new Map<string, KitMembershipRow[]>();
  }

  const rows = db
    .prepare(
      `
        SELECT
          kit_assets.asset_id,
          kits.id AS kit_id,
          kits.code AS kit_code,
          kits.name AS kit_name
        FROM kit_assets
        JOIN kits ON kits.id = kit_assets.kit_id
        WHERE kits.is_active = 1
          AND kit_assets.asset_id IN (${createPlaceholders(assetIds)})
        ORDER BY kits.name, kits.code
      `,
    )
    .all(...assetIds) as KitMembershipRow[];

  const byAssetId = new Map<string, KitMembershipRow[]>();
  rows.forEach((row) => {
    const current = byAssetId.get(row.asset_id) ?? [];
    current.push(row);
    byAssetId.set(row.asset_id, current);
  });

  return byAssetId;
};

const ensureEntityExists = (value: string | undefined, label: string, map: Map<string, string>) => {
  if (!value) {
    return;
  }

  if (!map.has(value)) {
    throw new Error(`${label} not found.`);
  }
};

const buildFailedCommandMessage = (label: string, previousError?: string | null) =>
  previousError
    ? `This command id already failed once for ${label}: ${previousError}`
    : `This command id already failed once for ${label}. Generate a new action and retry.`;

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

const resolveDateOverlap = (
  leftStartDate: string | null | undefined,
  leftEndDate: string | null | undefined,
  rightStartDate: string | null | undefined,
  rightEndDate: string | null | undefined,
) => {
  if (!leftStartDate || !leftEndDate || !rightStartDate || !rightEndDate) {
    return false;
  }

  return leftStartDate <= rightEndDate && rightStartDate <= leftEndDate;
};

const buildConflictWarningSummary = (warnings: string[]) => {
  if (!warnings.length) {
    return undefined;
  }

  if (warnings.length === 1) {
    return warnings[0];
  }

  return `${warnings[0]} +${warnings.length - 1} more conflict warning${warnings.length === 2 ? "" : "s"}.`;
};

const resolveAssignableQuantity = (
  row: AssetStateRow,
  nextProjectId: string | null | undefined,
  nextProjectUnitId: string | null | undefined,
  nextDepartmentId: string | null | undefined,
  nextResponsibleUserId: string | null | undefined,
  nextLocationId: string | null | undefined,
) => {
  if (row.operational_status === "retired") {
    return 0;
  }

  const sameContext =
    row.current_project_id === (nextProjectId ?? null) &&
    row.project_unit_id === (nextProjectUnitId ?? null) &&
    row.current_department_id === (nextDepartmentId ?? null) &&
    row.current_responsible_user_id === (nextResponsibleUserId ?? null) &&
    row.current_location_id === (nextLocationId ?? null);

  if (sameContext) {
    return row.available_quantity;
  }

  if (row.available_quantity === 0 && row.assigned_quantity > 0 && row.checked_out_quantity === 0) {
    return row.assigned_quantity;
  }

  return row.available_quantity;
};

const ensureInternalCodeAvailable = (db: DatabaseSync, workspaceId: string, internalCode: string, currentAssetId?: string) => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM assets
        WHERE workspace_id = ?
          AND internal_code = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, internalCode, currentAssetId ?? null, currentAssetId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error(`Asset code ${internalCode} is already in use.`);
  }
};

const ensureAssetEditableReferences = (
  db: DatabaseSync,
  workspaceId: string,
  categoryId: string,
  locationId?: string,
) => {
  const categoryMap = loadCategoryEntities(db, workspaceId, uniqueValues([categoryId]));
  ensureEntityExists(categoryId, "Category", categoryMap);

  if (locationId) {
    const locationMap = loadNamedEntities(db, "locations", workspaceId, uniqueValues([locationId]));
    ensureEntityExists(locationId, "Default location", locationMap);
  }
};

const normalizeOptionalText = (value?: string) => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

export const createAssetMutationService = (db: DatabaseSync) => ({
  assignMoveAssets(input: AssignMoveAssetsInput): AssignMoveAssetsResult {
    const normalizedSelections = (input.assetSelections ?? [])
      .map((selection) => ({
        assetId: selection.assetId?.trim(),
        quantity: Math.trunc(selection.quantity),
      }))
      .filter((selection): selection is { assetId: string; quantity: number } => Boolean(selection.assetId));
    const requestedQuantityByAssetId = new Map<string, number>();

    normalizedSelections.forEach((selection) => {
      requestedQuantityByAssetId.set(selection.assetId, selection.quantity);
    });

    const assetIds = normalizedSelections.length ? [...requestedQuantityByAssetId.keys()] : uniqueValues(input.assetIds);
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
    const fail = (message: string): never => {
      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw new Error(message);
    };

    if (!assetIds.length) {
      fail("Select at least one asset before running assign or move.");
    }

    if (input.mode === "move" && !input.targetLocationId) {
      fail("Choose a destination location before moving assets.");
    }

    if (input.mode === "assign" && !input.projectId && !input.departmentId && !input.assignedToUserId) {
      fail("Assignment needs at least a project, department or responsible user.");
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
      .get(input.commandId) as { outcome_status: string; error_message: string | null } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        eventType: input.mode === "assign" ? "assigned" : "moved",
        processedAssetIds: assetIds,
        repeated: true,
        summary: "This command was already applied.",
        conflictCount: 0,
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("asset assign / move", existingReceipt.error_message));
    }

    const projectMap = loadNamedEntities(db, "projects", input.workspaceId, uniqueValues([input.projectId]));
    const projectEntityMap = loadProjectEntities(db, input.workspaceId, uniqueValues([input.projectId]));
    const departmentMap = loadNamedEntities(db, "departments", input.workspaceId, uniqueValues([input.departmentId]));
    const locationMap = loadNamedEntities(db, "locations", input.workspaceId, uniqueValues([input.targetLocationId]));
    const projectUnitMap = loadProjectUnitEntities(db, input.workspaceId, uniqueValues([input.projectUnitId]));
    const userMap = loadUserEntities(db, input.workspaceId, uniqueValues([input.assignedToUserId, defaultActorUserId]));

    if (input.projectId && !projectMap.has(input.projectId)) {
      fail("Project not found.");
    }

    if (input.departmentId && !departmentMap.has(input.departmentId)) {
      fail("Department not found.");
    }

    if (input.targetLocationId && !locationMap.has(input.targetLocationId)) {
      fail("Target location not found.");
    }

    if (input.assignedToUserId && !userMap.has(input.assignedToUserId)) {
      fail("Responsible user not found.");
    }

    if (!userMap.has(defaultActorUserId)) {
      fail("Actor user not found.");
    }

    if (input.projectUnitId && !projectUnitMap.has(input.projectUnitId)) {
      fail("Project unit not found.");
    }

    if (input.projectId) {
      const project = projectEntityMap.get(input.projectId);

      if (project?.status === "Wrapped") {
        fail(`${project.name} is wrapped and cannot receive new assignment activity.`);
      }
    }

    if (input.projectUnitId) {
      const nextUnit = projectUnitMap.get(input.projectUnitId);

      if (nextUnit) {
        try {
          assertProjectUnitSupportsOperationalFlow(
            nextUnit.start_date,
            nextUnit.end_date,
            nextUnit.status,
            nextUnit.status_source,
            nextUnit.name,
          );
        } catch (error) {
          fail(error instanceof Error ? error.message : "Project unit is not available for new operational activity.");
        }
      }
    }

    const assetStateRows = db
      .prepare(
        `
          SELECT
            asset_current_state.asset_id,
            assets.name AS asset_name,
            asset_current_state.current_location_id,
            asset_current_state.current_project_id,
            asset_current_state.project_unit_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.total_quantity,
            asset_current_state.available_quantity,
            asset_current_state.assigned_quantity,
            asset_current_state.checked_out_quantity,
            asset_current_state.version
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          WHERE asset_current_state.workspace_id = ?
            AND asset_current_state.asset_id IN (${createPlaceholders(assetIds)})
        `,
      )
      .all(input.workspaceId, ...assetIds) as AssetStateRow[];

    if (assetStateRows.length !== assetIds.length) {
      fail("One or more selected assets no longer exist in the local registry.");
    }

    const kitMembershipsByAssetId = loadKitMemberships(db, assetIds);
    const kitProtectedAsset = assetStateRows.find((row) => {
      const memberships = kitMembershipsByAssetId.get(row.asset_id) ?? [];

      if (!memberships.length) {
        return false;
      }

      if (!input.sourceKitId) {
        return true;
      }

      return !memberships.some((membership) => membership.kit_id === input.sourceKitId);
    });

    if (kitProtectedAsset) {
      const memberships = kitMembershipsByAssetId.get(kitProtectedAsset.asset_id) ?? [];
      const membershipLabel = memberships
        .map((membership) => `${membership.kit_code} · ${membership.kit_name}`)
        .join(", ");

      fail(
        `${kitProtectedAsset.asset_name} is already part of the active kit${memberships.length === 1 ? "" : "s"} ${membershipLabel}. Remove it from the kit before assigning or moving it individually.`,
      );
    }

    if (input.mode === "assign") {
      const retiredAsset = assetStateRows.find((row) => row.operational_status === "retired");

      if (retiredAsset) {
        fail(`${retiredAsset.asset_name} is retired and can no longer be assigned.`);
      }

      const maintenanceAsset = assetStateRows.find((row) => row.operational_status === "maintenance");

      if (maintenanceAsset) {
        fail(`${maintenanceAsset.asset_name} is in maintenance and cannot be assigned right now.`);
      }
    }

    const invalidQuantityAsset =
      input.mode === "assign"
        ? assetStateRows.find((row) => {
            if (row.checked_out_quantity > 0) {
              return false;
            }

            const nextProjectId = input.projectId ?? row.current_project_id;
            const nextProjectUnitId =
              input.projectUnitId
                ? input.projectUnitId
                : input.projectId && input.projectId !== row.current_project_id
                  ? null
                  : row.project_unit_id;
            const nextDepartmentId = input.departmentId ?? row.current_department_id;
            const nextResponsibleUserId = input.assignedToUserId ?? row.current_responsible_user_id;
            const nextLocationId = input.targetLocationId ?? row.current_location_id;
            const sourceQuantity = resolveAssignableQuantity(
              row,
              nextProjectId,
              nextProjectUnitId,
              nextDepartmentId,
              nextResponsibleUserId,
              nextLocationId,
            );
            const requestedQuantity = requestedQuantityByAssetId.get(row.asset_id) ?? sourceQuantity;
            return (
              !Number.isInteger(requestedQuantity) ||
              requestedQuantity < 1 ||
              requestedQuantity > Math.max(0, sourceQuantity)
            );
          })
        : null;

    if (invalidQuantityAsset) {
      fail(`Requested quantity for ${invalidQuantityAsset.asset_name} exceeds what is currently available for assignment.`);
    }

    const currentLocationIds = uniqueValues(assetStateRows.map((row) => row.current_location_id));
    const currentLocationMap = loadNamedEntities(db, "locations", input.workspaceId, currentLocationIds);
    const processedRows =
      input.mode === "move"
        ? assetStateRows.filter((row) => row.current_location_id !== input.targetLocationId)
        : assetStateRows.filter((row) => {
            const nextProjectId = input.projectId ?? row.current_project_id;
            const nextProjectUnitId =
              input.projectUnitId
                ? input.projectUnitId
                : input.projectId && input.projectId !== row.current_project_id
                  ? null
                  : row.project_unit_id;
            const nextDepartmentId = input.departmentId ?? row.current_department_id;
            const nextResponsibleUserId = input.assignedToUserId ?? row.current_responsible_user_id;
            const nextLocationId = input.targetLocationId ?? row.current_location_id;
            const sourceQuantity = resolveAssignableQuantity(
              row,
              nextProjectId,
              nextProjectUnitId,
              nextDepartmentId,
              nextResponsibleUserId,
              nextLocationId,
            );
            const requestedQuantity = requestedQuantityByAssetId.get(row.asset_id) ?? sourceQuantity;
            const isSameContext =
              row.current_project_id === nextProjectId &&
              row.project_unit_id === nextProjectUnitId &&
              row.current_department_id === nextDepartmentId &&
              row.current_responsible_user_id === nextResponsibleUserId &&
              row.current_location_id === nextLocationId;

            return (
              row.active_assignment_id === null ||
              row.custody_status !== "assigned" ||
              !isSameContext ||
              requestedQuantity !== sourceQuantity ||
              Boolean(input.expectedReturnAt)
            );
          });

    if (!processedRows.length) {
      fail("The selected assets already match the requested assignment or movement.");
    }

    if (input.mode === "assign") {
      const checkedOutAsset = processedRows.find((row) => row.checked_out_quantity > 0);

      if (checkedOutAsset) {
        fail(`${checkedOutAsset.asset_name} is currently checked out. Return it before reassigning it.`);
      }

      const partiallyAllocatedAsset = processedRows.find((row) => {
        if (!(row.available_quantity > 0 && row.assigned_quantity > 0)) {
          return false;
        }

        const requestedQuantity = requestedQuantityByAssetId.get(row.asset_id) ?? row.available_quantity;
        const nextProjectId = input.projectId ?? row.current_project_id;
        const nextProjectUnitId =
          input.projectUnitId
            ? input.projectUnitId
            : input.projectId && input.projectId !== row.current_project_id
              ? null
              : row.project_unit_id;
        const nextDepartmentId = input.departmentId ?? row.current_department_id;
        const nextResponsibleUserId = input.assignedToUserId ?? row.current_responsible_user_id;
        const nextLocationId = input.targetLocationId ?? row.current_location_id;
        const sameContext =
          row.current_project_id === nextProjectId &&
          row.project_unit_id === nextProjectUnitId &&
          row.current_department_id === nextDepartmentId &&
          row.current_responsible_user_id === nextResponsibleUserId &&
          row.current_location_id === nextLocationId;

        return !sameContext || requestedQuantity > row.available_quantity;
      });

      if (partiallyAllocatedAsset) {
        fail(
          `${partiallyAllocatedAsset.asset_name} already has partial quantity allocated in a different active context. Finish that flow before reassigning this bulk row.`,
        );
      }
    } else {
      const checkedOutAsset = processedRows.find((row) => row.custody_status === "checked_out");

      if (checkedOutAsset) {
        fail(`${checkedOutAsset.asset_name} is currently checked out. Use the return flow before moving it.`);
      }
    }

    const now = new Date().toISOString();
    const eventType = input.mode === "assign" ? "assigned" : "moved";
    const currentProjectIds = uniqueValues(processedRows.map((row) => row.current_project_id));
    const currentProjectWindows = currentProjectIds.length
      ? (db
          .prepare(
            `
              SELECT id, name, start_date, end_date
              FROM projects
              WHERE id IN (${createPlaceholders(currentProjectIds)})
            `,
          )
          .all(...currentProjectIds) as Array<{
          id: string;
          name: string;
          start_date: string | null;
          end_date: string | null;
        }>)
      : [];
    const currentProjectWindowMap = new Map(currentProjectWindows.map((row) => [row.id, row] as const));
    const targetProjectWindow = input.projectId
      ? ((db
          .prepare("SELECT id, name, start_date, end_date FROM projects WHERE id = ? LIMIT 1")
          .get(input.projectId) as { id: string; name: string; start_date: string | null; end_date: string | null } | undefined) ??
        null)
      : null;
    const targetUnitWindow = input.projectUnitId ? projectUnitMap.get(input.projectUnitId) ?? null : null;
    const targetWindowStart = targetUnitWindow?.start_date ?? targetProjectWindow?.start_date ?? null;
    const targetWindowEnd = targetUnitWindow?.end_date ?? targetProjectWindow?.end_date ?? null;
    const warnings =
      input.mode === "assign" && input.projectId
        ? processedRows.reduce<string[]>((messages, row) => {
            if (!row.current_project_id || row.current_project_id === input.projectId) {
              return messages;
            }

            const currentProject = currentProjectWindowMap.get(row.current_project_id);
            const overlaps = resolveDateOverlap(
              currentProject?.start_date,
              currentProject?.end_date,
              targetWindowStart,
              targetWindowEnd,
            );

            if (!overlaps && targetWindowStart && targetWindowEnd) {
              return messages;
            }

            messages.push(
              `${row.asset_name} is still linked to ${currentProject?.name ?? "another project"} while this new assignment overlaps its current schedule.`,
            );
            return messages;
          }, [])
        : [];

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
            project_unit_id,
            assigned_to_user_id,
            assigned_by_user_id,
          source_location_id,
          target_location_id,
          quantity,
          assignment_status,
          checked_out_at,
          expected_return_at,
            returned_at,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `,
      );
      const updateAssignmentStatement = db.prepare(
        `
          UPDATE asset_assignments
          SET
            project_id = ?,
            department_id = ?,
            project_unit_id = ?,
            assigned_to_user_id = ?,
            target_location_id = ?,
            quantity = ?,
            assignment_status = 'assigned',
            checked_out_at = NULL,
            expected_return_at = ?,
            notes = ?,
            updated_at = ?
          WHERE id = ?
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
            project_unit_id = ?,
            current_responsible_user_id = ?,
            active_assignment_id = ?,
            available_quantity = ?,
            assigned_quantity = ?,
            checked_out_quantity = ?,
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
        let nextProjectId = input.mode === "assign" ? input.projectId ?? row.current_project_id : row.current_project_id;
        let nextProjectUnitId =
          input.mode === "assign"
            ? input.projectId && input.projectId !== row.current_project_id
              ? null
              : row.project_unit_id
            : row.project_unit_id;
        const nextDepartmentId = input.mode === "assign" ? input.departmentId ?? row.current_department_id : row.current_department_id;
        const nextResponsibleUserId =
          input.mode === "assign" ? input.assignedToUserId ?? row.current_responsible_user_id : row.current_responsible_user_id;
        let nextAssignmentId = row.active_assignment_id;

        if (input.mode === "assign" && input.projectUnitId) {
          const nextUnit = projectUnitMap.get(input.projectUnitId);

          if (!nextUnit) {
            throw new Error("Project unit not found.");
          }

          if (nextProjectId && nextProjectId !== nextUnit.project_id) {
            throw new Error("Selected unit does not belong to the chosen project.");
          }

          nextProjectId = nextUnit.project_id;
          nextProjectUnitId = nextUnit.id;
        }

        if (!nextProjectId) {
          nextProjectUnitId = null;
        }

        const sourceQuantity =
          input.mode === "assign"
            ? resolveAssignableQuantity(
                row,
                nextProjectId,
                nextProjectUnitId,
                nextDepartmentId,
                nextResponsibleUserId,
                targetLocationId,
              )
            : row.available_quantity;
        const requestedQuantity = requestedQuantityByAssetId.get(row.asset_id) ?? sourceQuantity;
        const assignSourceFlow =
          input.mode === "assign" && sourceQuantity === row.assigned_quantity && row.available_quantity === 0 ? "assigned" : "available";

        if (input.mode === "assign") {
          const sameActiveContext =
            row.active_assignment_id &&
            row.checked_out_quantity === 0 &&
            row.current_project_id === nextProjectId &&
            row.project_unit_id === nextProjectUnitId &&
            row.current_department_id === nextDepartmentId &&
            row.current_responsible_user_id === nextResponsibleUserId &&
            row.current_location_id === targetLocationId;

          if (row.active_assignment_id && !sameActiveContext) {
            closeAssignmentStatement.run(now, row.active_assignment_id);
          }

          if (sameActiveContext && row.active_assignment_id) {
            nextAssignmentId = row.active_assignment_id;
            updateAssignmentStatement.run(
              nextProjectId,
              nextDepartmentId,
              nextProjectUnitId,
              nextResponsibleUserId,
              targetLocationId,
              row.assigned_quantity + requestedQuantity,
              input.expectedReturnAt?.trim() || null,
              input.notes?.trim() || null,
              now,
              row.active_assignment_id,
            );
          } else {
            nextAssignmentId = `assign-${input.commandId}-${index}`;

            insertAssignmentStatement.run(
              nextAssignmentId,
              input.workspaceId,
              row.asset_id,
              nextProjectId,
              nextDepartmentId,
              nextProjectUnitId,
              nextResponsibleUserId,
              defaultActorUserId,
              row.current_location_id,
              targetLocationId,
              requestedQuantity,
              "assigned",
              now,
              input.expectedReturnAt?.trim() || null,
              input.notes?.trim() || null,
              now,
              now,
            );
          }
        } else if (row.active_assignment_id && targetLocationId !== row.current_location_id) {
          updateAssignmentLocationStatement.run(targetLocationId, now, row.active_assignment_id);
        }

        const eventId = `event-${input.commandId}-${index}`;
        const projectName = nextProjectId ? projectMap.get(nextProjectId) : undefined;
        const departmentName = nextDepartmentId ? departmentMap.get(nextDepartmentId) : undefined;
        const unitName = nextProjectUnitId ? projectUnitMap.get(nextProjectUnitId)?.name : undefined;
        const targetLocationName = targetLocationId ? locationMap.get(targetLocationId) ?? currentLocationMap.get(targetLocationId) : undefined;
        const sourceLocationName = row.current_location_id ? currentLocationMap.get(row.current_location_id) : undefined;
        const responsibleName = nextResponsibleUserId ? userMap.get(nextResponsibleUserId) : undefined;
        const note =
          input.notes?.trim() ||
          (input.mode === "assign"
            ? buildAssignmentNote(
                row.asset_name,
                unitName ? `${projectName ?? departmentName ?? "Project"} / ${unitName}` : projectName ?? departmentName,
                responsibleName,
                targetLocationName,
              )
            : buildMoveNote(row.asset_name, sourceLocationName, targetLocationName));

        const metadataJson = JSON.stringify({
          mode: input.mode,
          previous: {
            locationId: row.current_location_id,
            projectId: row.current_project_id,
            projectUnitId: row.project_unit_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            activeAssignmentId: row.active_assignment_id,
            custodyStatus: row.custody_status,
          },
          next: {
            locationId: targetLocationId,
            projectId: nextProjectId,
            projectUnitId: nextProjectUnitId,
            departmentId: nextDepartmentId,
            responsibleUserId: nextResponsibleUserId,
            activeAssignmentId: nextAssignmentId,
            custodyStatus: input.mode === "assign" ? "assigned" : row.custody_status,
          },
          expectedReturnAt: input.expectedReturnAt ?? null,
          quantity: input.mode === "assign" ? requestedQuantity : null,
        });
        const nextAvailableQuantity =
          input.mode === "assign"
            ? assignSourceFlow === "assigned"
              ? row.available_quantity
              : Math.max(0, row.available_quantity - requestedQuantity)
            : row.available_quantity;
        const nextAssignedQuantity =
          input.mode === "assign"
            ? assignSourceFlow === "assigned"
              ? requestedQuantity
              : row.assigned_quantity + requestedQuantity
            : row.assigned_quantity;
        const nextCheckedOutQuantity = input.mode === "assign" ? 0 : row.checked_out_quantity;

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
          nextProjectUnitId,
          nextResponsibleUserId,
          nextAssignmentId,
          nextAvailableQuantity,
          nextAssignedQuantity,
          nextCheckedOutQuantity,
          input.mode === "assign" ? (nextAvailableQuantity > 0 ? "partial_assigned" : "assigned") : row.custody_status,
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
        conflictCount: warnings.length,
        warningSummary: buildConflictWarningSummary(warnings),
        warnings,
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

  createAsset(input: CreateAssetCommand): AssetEditorMutationResult {
    const existingReceipt = db
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ? LIMIT 1")
      .get(input.commandId) as { outcome_status: string; error_message: string | null } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      const existingAssetId = db
        .prepare("SELECT entity_id FROM sync_outbox WHERE id = ? LIMIT 1")
        .get(`outbox-event-${input.commandId}`) as { entity_id: string } | undefined;

      return {
        commandId: input.commandId,
        assetId: existingAssetId?.entity_id ?? "unknown-asset",
        repeated: true,
        summary: "This asset create command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("asset create", existingReceipt.error_message));
    }

    const assetName = input.name.trim();
    const internalCode = input.internalCode.trim().toUpperCase();
    const now = new Date().toISOString();
    const assetId = `asset-${internalCode.toLowerCase()}-${Date.now().toString(36)}`;
    const eventId = `event-${input.commandId}`;
    const codeService = createCodeGenerationService(db);

    if (!assetName) {
      throw new Error("Asset name is required.");
    }

    ensureInternalCodeAvailable(db, input.workspaceId, internalCode);
    ensureAssetEditableReferences(db, input.workspaceId, input.categoryId, input.defaultLocationId ?? undefined);

    db.exec("BEGIN");

    try {
      const totalQuantity = Math.max(0, Math.trunc(input.totalQuantity ?? 1));
      const primaryCode = codeService.ensurePrimaryCode({
        workspaceId: input.workspaceId,
        entityType: "asset",
        entityId: assetId,
        preferredCodeValue: input.qrCodeValue?.trim() || `AST-${internalCode}`,
      });

      db.prepare(
        `
          INSERT INTO assets (
            id,
            workspace_id,
            category_id,
            name,
            brand,
            model,
            serial_number,
            internal_code,
            description,
            purchase_price,
            additional_costs,
            replacement_value,
            current_book_value,
            ownership_type,
            default_location_id,
            qr_code_value,
            notes,
            is_active,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        assetId,
        input.workspaceId,
        input.categoryId,
        assetName,
        normalizeOptionalText(input.brand),
        normalizeOptionalText(input.model),
        normalizeOptionalText(input.serialNumber),
        internalCode,
        normalizeOptionalText(input.description),
        typeof input.purchasePrice === "number" ? input.purchasePrice : null,
        typeof input.additionalCosts === "number" ? input.additionalCosts : null,
        typeof input.replacementValue === "number" ? input.replacementValue : null,
        typeof input.currentBookValue === "number" ? input.currentBookValue : null,
        normalizeOptionalText(input.ownershipType) ?? "owned",
        input.defaultLocationId?.trim() || null,
        primaryCode.codeValue,
        normalizeOptionalText(input.notes),
        input.isActive === false ? 0 : 1,
        now,
        now,
      );

      const metadataJson = JSON.stringify({
        kind: "asset_created",
        internalCode,
        categoryId: input.categoryId,
        defaultLocationId: input.defaultLocationId?.trim() || null,
        primaryCodeValue: primaryCode.codeValue,
        totalQuantity,
        purchasePrice: input.purchasePrice ?? null,
        additionalCosts: input.additionalCosts ?? null,
        replacementValue: input.replacementValue ?? null,
        currentBookValue: input.currentBookValue ?? null,
      });

      db.prepare(
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
          VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'asset_created', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        eventId,
        input.workspaceId,
        assetId,
        defaultActorUserId,
        input.defaultLocationId?.trim() || null,
        input.defaultLocationId?.trim() || null,
        now,
        input.commandId,
        input.actorType,
        input.sourceChannel,
        `Created asset ${assetName}.`,
        metadataJson,
        now,
      );

      db.prepare(
        `
          INSERT INTO asset_current_state (
            asset_id,
            workspace_id,
            current_location_id,
            current_project_id,
            current_department_id,
            current_responsible_user_id,
            active_assignment_id,
            condition_status,
            operational_status,
            custody_status,
            total_quantity,
            available_quantity,
            assigned_quantity,
            checked_out_quantity,
            last_event_id,
            version,
            updated_at
          )
          VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, 'available', 'available', ?, ?, 0, 0, ?, 1, ?)
        `,
      ).run(
        assetId,
        input.workspaceId,
        input.defaultLocationId?.trim() || null,
        input.conditionStatus.trim() || "Good",
        totalQuantity,
        totalQuantity,
        eventId,
        now,
      );

      db.prepare(
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
      ).run(`outbox-${eventId}`, input.workspaceId, assetId, eventId, metadataJson, now, now);

      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'success', NULL)
        `,
      ).run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now);

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        assetId,
        repeated: false,
        summary: `Created ${assetName} in the live registry.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
        `,
      ).run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        error instanceof Error ? error.message : "Unknown asset create error",
      );
      throw error;
    }
  },

  updateAsset(input: UpdateAssetCommand): AssetEditorMutationResult {
    const existingReceipt = db
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ? LIMIT 1")
      .get(input.commandId) as { outcome_status: string; error_message: string | null } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        assetId: input.assetId,
        repeated: true,
        summary: "This asset update command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("asset update", existingReceipt.error_message));
    }

    const assetName = input.name.trim();
    const internalCode = input.internalCode.trim().toUpperCase();
    const now = new Date().toISOString();
    const eventId = `event-${input.commandId}`;
    const codeService = createCodeGenerationService(db);

    if (!assetName) {
      throw new Error("Asset name is required.");
    }

    const assetRow = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            asset_current_state.version,
            asset_current_state.current_location_id,
            asset_current_state.current_project_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.custody_status,
            asset_current_state.operational_status
          FROM assets
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          WHERE assets.id = ?
          LIMIT 1
        `,
      )
      .get(input.assetId) as
      | {
          id: string;
          name: string;
          version: number;
          current_location_id: string | null;
          current_project_id: string | null;
          current_department_id: string | null;
          current_responsible_user_id: string | null;
          active_assignment_id: string | null;
          custody_status: string;
          operational_status: string;
        }
      | undefined;

    if (!assetRow) {
      throw new Error("Asset not found.");
    }

    ensureInternalCodeAvailable(db, input.workspaceId, internalCode, input.assetId);
    ensureAssetEditableReferences(db, input.workspaceId, input.categoryId, input.defaultLocationId ?? undefined);

    db.exec("BEGIN");

    try {
      const primaryCode = codeService.ensurePrimaryCode({
        workspaceId: input.workspaceId,
        entityType: "asset",
        entityId: input.assetId,
        preferredCodeValue: input.qrCodeValue?.trim() || `AST-${internalCode}`,
      });

      db.prepare(
        `
          UPDATE assets
          SET
            category_id = ?,
            name = ?,
            brand = ?,
            model = ?,
            serial_number = ?,
            internal_code = ?,
            description = ?,
            purchase_price = ?,
            additional_costs = ?,
            replacement_value = ?,
            current_book_value = ?,
            ownership_type = ?,
            default_location_id = ?,
            qr_code_value = ?,
            notes = ?,
            is_active = ?,
            updated_at = ?
          WHERE id = ?
        `,
      ).run(
        input.categoryId,
        assetName,
        normalizeOptionalText(input.brand),
        normalizeOptionalText(input.model),
        normalizeOptionalText(input.serialNumber),
        internalCode,
        normalizeOptionalText(input.description),
        typeof input.purchasePrice === "number" ? input.purchasePrice : null,
        typeof input.additionalCosts === "number" ? input.additionalCosts : null,
        typeof input.replacementValue === "number" ? input.replacementValue : null,
        typeof input.currentBookValue === "number" ? input.currentBookValue : null,
        normalizeOptionalText(input.ownershipType) ?? "owned",
        input.defaultLocationId?.trim() || null,
        primaryCode.codeValue,
        normalizeOptionalText(input.notes),
        input.isActive === false ? 0 : 1,
        now,
        input.assetId,
      );

      const metadataJson = JSON.stringify({
        kind: "asset_profile_updated",
        internalCode,
        categoryId: input.categoryId,
        defaultLocationId: input.defaultLocationId?.trim() || null,
        primaryCodeValue: primaryCode.codeValue,
        purchasePrice: input.purchasePrice ?? null,
        additionalCosts: input.additionalCosts ?? null,
        replacementValue: input.replacementValue ?? null,
        currentBookValue: input.currentBookValue ?? null,
      });

      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        eventId,
        input.workspaceId,
        input.assetId,
        assetRow.active_assignment_id,
        assetRow.current_project_id,
        assetRow.current_department_id,
        defaultActorUserId,
        assetRow.current_location_id,
        assetRow.current_location_id,
        assetRow.current_location_id,
        now,
        input.commandId,
        input.actorType,
        input.sourceChannel,
        `Updated ${assetName} profile fields and scan metadata.`,
        metadataJson,
        now,
      );

      db.prepare(
        `
          UPDATE asset_current_state
          SET
            condition_status = ?,
            last_event_id = ?,
            version = ?,
            updated_at = ?
          WHERE asset_id = ?
        `,
      ).run(input.conditionStatus.trim() || "Good", eventId, assetRow.version + 1, now, input.assetId);

      db.prepare(
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
      ).run(`outbox-${eventId}`, input.workspaceId, input.assetId, eventId, metadataJson, now, now);

      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'success', NULL)
        `,
      ).run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now);

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        assetId: input.assetId,
        repeated: false,
        summary: `Updated ${assetName}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
        `,
      ).run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        error instanceof Error ? error.message : "Unknown asset update error",
      );
      throw error;
    }
  },

  archiveAsset(input: ArchiveAssetCommand): AssetEditorMutationResult {
    const existingReceipt = db
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ? LIMIT 1")
      .get(input.commandId) as { outcome_status: string; error_message: string | null } | undefined;

    if (existingReceipt?.outcome_status === "success") {
      return {
        commandId: input.commandId,
        assetId: input.assetId,
        repeated: true,
        summary: "This asset archive command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("asset archive", existingReceipt.error_message));
    }

    const now = new Date().toISOString();
    const eventId = `event-${input.commandId}`;
    const assetRow = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            assets.is_active,
            asset_current_state.version,
            asset_current_state.current_location_id,
            asset_current_state.current_project_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.custody_status
          FROM assets
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          WHERE assets.id = ?
          LIMIT 1
        `,
      )
      .get(input.assetId) as
      | {
          id: string;
          name: string;
          is_active: number;
          version: number;
          current_location_id: string | null;
          current_project_id: string | null;
          current_department_id: string | null;
          current_responsible_user_id: string | null;
          active_assignment_id: string | null;
          custody_status: string;
        }
      | undefined;

    if (!assetRow) {
      throw new Error("Asset not found.");
    }

    if (!assetRow.is_active) {
      return {
        commandId: input.commandId,
        assetId: input.assetId,
        repeated: false,
        summary: `${assetRow.name} is already archived.`,
      };
    }

    if (assetRow.active_assignment_id || assetRow.custody_status !== "available") {
      throw new Error("This asset is still operationally assigned or checked out and cannot be archived.");
    }

    const openIncidentCount = (db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM incidents
          WHERE asset_id = ?
            AND status IN ('Open', 'In review')
        `,
      )
      .get(input.assetId) as { count: number }).count;

    if (openIncidentCount > 0) {
      throw new Error("This asset still has open incidents and cannot be archived yet.");
    }

    db.exec("BEGIN");

    try {
      db.prepare("UPDATE assets SET is_active = 0, updated_at = ? WHERE id = ?").run(now, input.assetId);

      const metadataJson = JSON.stringify({
        kind: "asset_archived",
      });

      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'status_changed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        eventId,
        input.workspaceId,
        input.assetId,
        null,
        assetRow.current_project_id,
        assetRow.current_department_id,
        defaultActorUserId,
        assetRow.current_location_id,
        assetRow.current_location_id,
        assetRow.current_location_id,
        now,
        input.commandId,
        input.actorType,
        input.sourceChannel,
        `Archived ${assetRow.name} from the active registry.`,
        metadataJson,
        now,
      );

      db.prepare(
        `
          UPDATE asset_current_state
          SET last_event_id = ?, version = ?, updated_at = ?
          WHERE asset_id = ?
        `,
      ).run(eventId, assetRow.version + 1, now, input.assetId);

      db.prepare(
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
      ).run(`outbox-${eventId}`, input.workspaceId, input.assetId, eventId, metadataJson, now, now);

      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'success', NULL)
        `,
      ).run(input.commandId, input.workspaceId, defaultActorUserId, input.actorType, input.sourceChannel, now);

      db.exec("COMMIT");

      return {
        commandId: input.commandId,
        assetId: input.assetId,
        repeated: false,
        summary: `${assetRow.name} archived from the live registry.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      db.prepare(
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
          VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
        `,
      ).run(
        input.commandId,
        input.workspaceId,
        defaultActorUserId,
        input.actorType,
        input.sourceChannel,
        now,
        error instanceof Error ? error.message : "Unknown asset archive error",
      );
      throw error;
    }
  },
});
