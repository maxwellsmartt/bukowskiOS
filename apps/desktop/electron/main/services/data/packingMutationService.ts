import type { DatabaseSync } from "node:sqlite";

import type {
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
} from "@contracts";
import { assertProjectUnitSupportsOperationalFlow } from "./projectScheduling";
import { resolveAuthorizedActor } from "./mutationAuthorization";

type PackingAssetRow = {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  current_location_id: string | null;
  default_location_id: string | null;
  current_project_id: string | null;
  project_unit_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  condition_status: string;
  operational_status: string;
  custody_status: string;
  version: number;
  total_quantity: number;
  available_quantity: number;
  assigned_quantity: number;
  checked_out_quantity: number;
};

type PackingSlipRow = {
  id: string;
  project_id: string;
  project_unit_id: string | null;
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
  quantity: number;
  source_flow: string;
  current_location_id: string | null;
  default_location_id: string | null;
  current_project_id: string | null;
  project_unit_id: string | null;
  current_department_id: string | null;
  current_responsible_user_id: string | null;
  active_assignment_id: string | null;
  condition_status: string;
  operational_status: string;
  available_quantity: number;
  assigned_quantity: number;
  checked_out_quantity: number;
  version: number;
  condition_out: string | null;
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

type SlipCountRow = {
  item_count: number;
  returned_count: number | null;
};

type ProjectUnitRow = {
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
) => {
  if (!values.length) {
    return new Map<string, string>();
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

const loadProjectUnitEntities = (db: DatabaseSync, workspaceId: string, values: string[]) => {
  if (!values.length) {
    return new Map<string, ProjectUnitRow>();
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
    .all(workspaceId, ...values) as ProjectUnitRow[];

  return new Map(rows.map((row) => [row.id, row]));
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
  const itemLabel = itemCount === 1 ? "item" : "items";
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

const deriveCustodyStatus = (
  operationalStatus: string,
  availableQuantity: number,
  assignedQuantity: number,
  checkedOutQuantity: number,
) => {
  if (operationalStatus === "maintenance") {
    return "maintenance";
  }

  if (checkedOutQuantity > 0 && assignedQuantity > 0) {
    return "partially_allocated";
  }

  if (checkedOutQuantity > 0 && availableQuantity > 0) {
    return "partial_checked_out";
  }

  if (assignedQuantity > 0 && availableQuantity > 0) {
    return "partial_assigned";
  }

  if (checkedOutQuantity > 0) {
    return "checked_out";
  }

  if (assignedQuantity > 0) {
    return "assigned";
  }

  return "available";
};

export const createPackingMutationService = (db: DatabaseSync) => ({
  createPackingSlip(input: CreatePackingSlipCommand): CreatePackingSlipResult {
    const actor = resolveAuthorizedActor(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      requiredPermission: "packing-slips.create",
      actionLabel: "create packing slips",
    });
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
        actor.actorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw new Error(message);
    };

    if (!assetIds.length) {
      fail("Select at least one asset before issuing a packing slip.");
    }

    if (!input.projectId?.trim()) {
      fail("Choose a project before issuing a packing slip.");
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
        packingSlipId: `packing-${input.commandId}`,
        slipNumber: "PS-repeat",
        processedAssetIds: assetIds,
        repeated: true,
        summary: "This packing command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("packing issue", existingReceipt.error_message));
    }

    const projectMap = loadNamedEntities(db, "projects", input.workspaceId, uniqueValues([input.projectId]));
    const projectEntityMap = loadProjectEntities(db, input.workspaceId, uniqueValues([input.projectId]));
    const departmentMap = loadNamedEntities(db, "departments", input.workspaceId, uniqueValues([input.departmentId]));
    const projectUnitMap = loadProjectUnitEntities(db, input.workspaceId, uniqueValues([input.projectUnitId]));
    const userMap = loadUserEntities(db, input.workspaceId, uniqueValues([input.responsibleUserId, actor.actorUserId]));

    if (input.projectId && !projectMap.has(input.projectId)) {
      fail("Project not found.");
    }

    if (input.departmentId && !departmentMap.has(input.departmentId)) {
      fail("Department not found.");
    }

    if (input.responsibleUserId && !userMap.has(input.responsibleUserId)) {
      fail("Responsible user not found.");
    }

    if (!userMap.has(actor.actorUserId)) {
      fail("Actor user not found.");
    }

    const explicitProjectUnit = input.projectUnitId ? projectUnitMap.get(input.projectUnitId) : undefined;

    if (input.projectUnitId && !explicitProjectUnit) {
      fail("Project unit not found.");
    }

    if (explicitProjectUnit && explicitProjectUnit.project_id !== input.projectId) {
      fail("Selected unit does not belong to the chosen project.");
    }

    const project = projectEntityMap.get(input.projectId);

    if (project?.status === "Wrapped") {
      fail(`${project.name} is wrapped and cannot receive new packing activity.`);
    }

    if (explicitProjectUnit) {
      try {
        assertProjectUnitSupportsOperationalFlow(
          explicitProjectUnit.start_date,
          explicitProjectUnit.end_date,
          explicitProjectUnit.status,
          explicitProjectUnit.status_source,
          explicitProjectUnit.name,
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : "Project unit is not available for packing.");
      }
    }

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
            asset_current_state.project_unit_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.condition_status,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.version,
            asset_current_state.total_quantity,
            asset_current_state.available_quantity,
            asset_current_state.assigned_quantity,
            asset_current_state.checked_out_quantity
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
      fail("One or more selected assets no longer exist in the live registry.");
    }

    const kitMembershipsByAssetId = loadKitMemberships(db, assetIds);
    const kitProtectedAsset = assetRows.find((row) => {
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
      const membershipLabel = memberships.map((membership) => `${membership.kit_code} · ${membership.kit_name}`).join(", ");
      fail(
        `${kitProtectedAsset.asset_name} is already part of the active kit${memberships.length === 1 ? "" : "s"} ${membershipLabel}. Remove it from the kit before issuing it individually on a packing slip.`,
      );
    }

    const retiredAsset = assetRows.find((row) => row.operational_status === "retired");

    if (retiredAsset) {
      fail(`${retiredAsset.asset_name} is retired and cannot be issued on a packing slip.`);
    }

    const invalidQuantityAsset = assetRows.find((row) => {
      const sourceQuantity =
        row.current_project_id === input.projectId && row.assigned_quantity > 0 ? row.assigned_quantity : row.available_quantity;
      const requestedQuantity = requestedQuantityByAssetId.get(row.asset_id) ?? sourceQuantity;

      return !Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > Math.max(0, sourceQuantity);
    });

    if (invalidQuantityAsset) {
      fail(
        `Requested quantity for ${invalidQuantityAsset.asset_name} exceeds what is currently available in inventory.`,
      );
    }

    const maintenanceAsset = assetRows.find((row) => row.operational_status === "maintenance");

    if (maintenanceAsset) {
      fail(`${maintenanceAsset.asset_name} is in maintenance and cannot be packed out right now.`);
    }

    const checkedOutAsset = assetRows.find((row) => row.custody_status === "checked_out");

    if (checkedOutAsset) {
      fail(`${checkedOutAsset.asset_name} is already checked out on another active flow.`);
    }

    const conflictingProjectAsset = assetRows.find(
      (row) => row.custody_status === "assigned" && row.current_project_id && row.current_project_id !== input.projectId,
    );

    if (conflictingProjectAsset) {
      fail(
        `${conflictingProjectAsset.asset_name} is still assigned to another project. Reassign it before issuing this slip.`,
      );
    }

    const sequence = getNextPackingSequence(db);
    const { packingSlipId, slipNumber } = buildPackingIdentifiers(sequence);
    const now = new Date().toISOString();
    const nextDepartmentId = input.departmentId?.trim() || null;
    const nextResponsibleUserId = input.responsibleUserId?.trim() || null;
    const nextReturnDueAt = input.returnDueAt?.trim() || null;

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO packing_slips (
            id,
            workspace_id,
            project_id,
            project_unit_id,
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
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'Issued', ?, ?, ?, ?, ?)
        `,
      ).run(
        packingSlipId,
        input.workspaceId,
        input.projectId,
        explicitProjectUnit?.id ?? null,
        nextDepartmentId,
        actor.actorUserId,
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
            source_flow,
            source_kit_id,
            condition_out,
            condition_in,
            returned_at,
            notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_out', ?, ?, NULL, ?, ?, ?)
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
      let totalIssuedQuantity = 0;

      assetRows.forEach((row, index) => {
        const assignmentId = row.active_assignment_id ?? `assign-${input.commandId}-${index}`;
        const nextLocationId = row.current_location_id;
        const responsibleUserId = nextResponsibleUserId ?? row.current_responsible_user_id;
        const departmentId = nextDepartmentId ?? row.current_department_id;
        const projectUnitId =
          explicitProjectUnit?.id ?? (row.current_project_id === input.projectId ? row.project_unit_id : null);
        const itemId = `packing-item-${input.commandId}-${index}`;
        const eventId = `event-${input.commandId}-${index}`;
        const sourceFlow = row.current_project_id === input.projectId && row.assigned_quantity > 0 ? "assigned" : "available";
        const requestedQuantity =
          requestedQuantityByAssetId.get(row.asset_id) ??
          (sourceFlow === "assigned" ? row.assigned_quantity : row.available_quantity);
        const nextAvailableQuantity =
          sourceFlow === "assigned" ? row.available_quantity : Math.max(0, row.available_quantity - requestedQuantity);
        const nextAssignedQuantity =
          sourceFlow === "assigned" ? Math.max(0, row.assigned_quantity - requestedQuantity) : row.assigned_quantity;
        const nextCheckedOutQuantity = row.checked_out_quantity + requestedQuantity;
        const nextCustodyStatus = deriveCustodyStatus(
          row.operational_status,
          nextAvailableQuantity,
          nextAssignedQuantity,
          nextCheckedOutQuantity,
        );
        const metadataJson = JSON.stringify({
          packingSlipId,
          slipNumber,
          quantity: requestedQuantity,
          sourceFlow,
          previous: {
            projectId: row.current_project_id,
            projectUnitId: row.project_unit_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            custodyStatus: row.custody_status,
          },
          next: {
            projectId: input.projectId,
            projectUnitId,
            departmentId,
            responsibleUserId,
            custodyStatus: nextCustodyStatus,
          },
          returnDueAt: nextReturnDueAt,
        });
        const note =
          input.notes?.trim() ||
          `Issued ${row.asset_name} on ${slipNumber} for ${projectMap.get(input.projectId)}${
            responsibleUserId ? ` · ${userMap.get(responsibleUserId)}` : ""
          }.`;

        const itemKitId =
          input.sourceKitId &&
          (kitMembershipsByAssetId.get(row.asset_id) ?? []).some((membership) => membership.kit_id === input.sourceKitId)
            ? input.sourceKitId
            : null;
        insertPackingItemStatement.run(
          itemId,
          packingSlipId,
          row.asset_id,
          requestedQuantity,
          sourceFlow,
          itemKitId,
          row.condition_status,
          note,
        );

        if (row.active_assignment_id) {
          updateAssignmentStatement.run(
            input.projectId,
            departmentId,
            projectUnitId,
            responsibleUserId,
            nextLocationId,
            nextAssignedQuantity + nextCheckedOutQuantity,
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
            projectUnitId,
            responsibleUserId,
            actor.actorUserId,
            row.current_location_id,
            nextLocationId,
            requestedQuantity,
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
          actor.actorUserId,
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
          projectUnitId,
          responsibleUserId,
          assignmentId,
          nextAvailableQuantity,
          nextAssignedQuantity,
          nextCheckedOutQuantity,
          nextCustodyStatus,
          eventId,
          row.version + 1,
          now,
          row.asset_id,
        );

        insertAssetOutboxStatement.run(`outbox-${eventId}`, input.workspaceId, row.asset_id, eventId, metadataJson, now, now);
        processedAssetIds.push(row.asset_id);
        totalIssuedQuantity += requestedQuantity;
      });

      insertPackingOutboxStatement.run(
        `outbox-${packingSlipId}`,
        input.workspaceId,
        packingSlipId,
        JSON.stringify({
          packingSlipId,
          slipNumber,
          projectId: input.projectId,
          projectUnitId: explicitProjectUnit?.id ?? null,
          departmentId: nextDepartmentId,
          responsibleUserId: nextResponsibleUserId,
          status: "Issued",
          assetIds: processedAssetIds,
          totalIssuedQuantity,
        }),
        now,
        now,
      );

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        actor.actorUserId,
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
        summary: buildIssueSummary(slipNumber, totalIssuedQuantity),
      };
    } catch (error) {
      db.exec("ROLLBACK");

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        actor.actorUserId,
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
    const actor = resolveAuthorizedActor(db, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      requiredPermission: "packing-slips.create",
      actionLabel: "return packing slip items",
    });
    const selectedAssetIds = uniqueValues(input.assetIds ?? []);
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
        actor.actorUserId,
        input.actorType,
        input.sourceChannel,
        new Date().toISOString(),
        "failed",
        message,
      );
      throw new Error(message);
    };
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
        packingSlipId: input.packingSlipId,
        processedAssetIds: selectedAssetIds,
        repeated: true,
        slipStatus: "Closed",
        summary: "This return command was already applied.",
      };
    }

    if (existingReceipt?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("packing return", existingReceipt.error_message));
    }

    const slip = db
      .prepare(
        `
          SELECT id, project_id, project_unit_id, department_id, responsible_user_id, status, return_due_date
          FROM packing_slips
          WHERE id = ?
            AND workspace_id = ?
          LIMIT 1
        `,
      )
      .get(input.packingSlipId, input.workspaceId) as PackingSlipRow | undefined;

    const resolvedSlip = slip ?? fail("Packing slip not found in the local registry.");

    const actorUserMap = loadUserEntities(db, input.workspaceId, [actor.actorUserId]);
    if (!actorUserMap.has(actor.actorUserId)) {
      fail("Actor user not found.");
    }

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
            packing_slip_items.quantity,
            packing_slip_items.source_flow,
            asset_current_state.current_location_id,
            assets.default_location_id,
            asset_current_state.current_project_id,
            asset_current_state.project_unit_id,
            asset_current_state.current_department_id,
            asset_current_state.current_responsible_user_id,
            asset_current_state.active_assignment_id,
            asset_current_state.condition_status,
            asset_current_state.operational_status,
            asset_current_state.available_quantity,
            asset_current_state.assigned_quantity,
            asset_current_state.checked_out_quantity,
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
      fail("All selected packing slip items are already returned.");
    }

    if (selectedAssetIds.length && pendingRows.length !== selectedAssetIds.length) {
      fail("Some selected assets are no longer pending on this packing slip.");
    }

    const now = new Date().toISOString();
    const conditionIn = input.conditionIn?.trim();
    const note = input.notes?.trim() || null;
    const slipNumber = input.packingSlipId.replace("packing-", "PS-");

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
            assignment_status = ?,
            quantity = ?,
            returned_at = ?,
            checked_out_at = ?,
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
            current_project_id = ?,
            project_unit_id = ?,
            current_department_id = ?,
            current_responsible_user_id = ?,
            active_assignment_id = ?,
            available_quantity = ?,
            assigned_quantity = ?,
            checked_out_quantity = ?,
            condition_status = ?,
            custody_status = ?,
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
      let returnedQuantity = 0;

      pendingRows.forEach((row, index) => {
        const nextLocationId = row.default_location_id ?? row.current_location_id;
        const nextCondition = conditionIn || row.condition_out || row.condition_status;
        const eventId = `event-${input.commandId}-${index}`;
        const restoresToAssigned = row.source_flow === "assigned";
        const nextAvailableQuantity = restoresToAssigned ? row.available_quantity : row.available_quantity + row.quantity;
        const nextAssignedQuantity = restoresToAssigned ? row.assigned_quantity + row.quantity : row.assigned_quantity;
        const nextCheckedOutQuantity = Math.max(0, row.checked_out_quantity - row.quantity);
        const nextCustodyStatus = deriveCustodyStatus(
          row.operational_status,
          nextAvailableQuantity,
          nextAssignedQuantity,
          nextCheckedOutQuantity,
        );
        const nextProjectId = nextAssignedQuantity > 0 || nextCheckedOutQuantity > 0 ? resolvedSlip.project_id : null;
        const nextProjectUnitId = nextAssignedQuantity > 0 || nextCheckedOutQuantity > 0 ? resolvedSlip.project_unit_id : null;
        const nextDepartmentId = nextAssignedQuantity > 0 || nextCheckedOutQuantity > 0 ? resolvedSlip.department_id : null;
        const nextResponsibleUserId =
          nextAssignedQuantity > 0 || nextCheckedOutQuantity > 0 ? resolvedSlip.responsible_user_id : null;
        const nextAssignmentId =
          nextAssignedQuantity > 0 || nextCheckedOutQuantity > 0 ? row.active_assignment_id : null;
        const metadataJson = JSON.stringify({
          packingSlipId: input.packingSlipId,
          slipNumber,
          previous: {
            locationId: row.current_location_id,
            projectId: row.current_project_id,
            projectUnitId: row.project_unit_id,
            departmentId: row.current_department_id,
            responsibleUserId: row.current_responsible_user_id,
            assignmentId: row.active_assignment_id,
          },
          next: {
            locationId: nextLocationId,
            conditionStatus: nextCondition,
            custodyStatus: nextCustodyStatus,
          },
        });
        const rowNote = note || `Returned ${row.asset_name} from ${slipNumber}.`;

        updatePackingItemStatement.run(nextCondition, now, rowNote, row.item_id);

        if (row.active_assignment_id) {
          const nextAssignmentStatus =
            nextCheckedOutQuantity > 0 ? "checked_out" : nextAssignedQuantity > 0 ? "assigned" : "returned";
          const nextAssignmentQuantity =
            nextAssignmentStatus === "returned" ? row.quantity : nextAssignedQuantity + nextCheckedOutQuantity;
          const nextReturnedAt = nextAssignmentStatus === "returned" ? now : null;
          const nextCheckedOutAt = nextAssignmentStatus === "checked_out" ? now : null;

          updateAssignmentStatement.run(
            nextAssignmentStatus,
            nextAssignmentQuantity,
            nextReturnedAt,
            nextCheckedOutAt,
            now,
            row.active_assignment_id,
          );
        }

        insertEventStatement.run(
          eventId,
          input.workspaceId,
          row.asset_id,
          row.active_assignment_id,
          resolvedSlip.project_id,
          resolvedSlip.department_id,
          actor.actorUserId,
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
          nextProjectId,
          nextProjectUnitId,
          nextDepartmentId,
          nextResponsibleUserId,
          nextAssignmentId,
          nextAvailableQuantity,
          nextAssignedQuantity,
          nextCheckedOutQuantity,
          nextCondition,
          nextCustodyStatus,
          eventId,
          row.version + 1,
          now,
          row.asset_id,
        );

        insertOutboxStatement.run(`outbox-${eventId}`, input.workspaceId, "asset_event", row.asset_id, eventId, metadataJson, now, now);
        processedAssetIds.push(row.asset_id);
        returnedQuantity += row.quantity;
      });

      const slipCounts = db
        .prepare(
          `
            SELECT
              COALESCE(SUM(quantity), 0) AS item_count,
              SUM(CASE WHEN returned_at IS NOT NULL THEN quantity ELSE 0 END) AS returned_count
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
        actor.actorUserId,
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
        summary: buildReturnSummary(slipNumber, returnedQuantity, slipStatus),
      };
    } catch (error) {
      db.exec("ROLLBACK");

      insertReceipt.run(
        input.commandId,
        input.workspaceId,
        actor.actorUserId,
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
