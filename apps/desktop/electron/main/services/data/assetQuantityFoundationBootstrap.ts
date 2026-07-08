import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
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

export const applyAssetQuantityFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "asset_current_state", "total_quantity")) {
    db.exec("ALTER TABLE asset_current_state ADD COLUMN total_quantity INTEGER NOT NULL DEFAULT 1;");
  }

  if (!hasColumn(db, "asset_current_state", "available_quantity")) {
    db.exec("ALTER TABLE asset_current_state ADD COLUMN available_quantity INTEGER NOT NULL DEFAULT 1;");
  }

  if (!hasColumn(db, "asset_current_state", "assigned_quantity")) {
    db.exec("ALTER TABLE asset_current_state ADD COLUMN assigned_quantity INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(db, "asset_current_state", "checked_out_quantity")) {
    db.exec("ALTER TABLE asset_current_state ADD COLUMN checked_out_quantity INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(db, "packing_slip_items", "source_flow")) {
    db.exec("ALTER TABLE packing_slip_items ADD COLUMN source_flow TEXT NOT NULL DEFAULT 'available';");
  }

  if (!hasColumn(db, "asset_assignments", "quantity")) {
    db.exec("ALTER TABLE asset_assignments ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;");
  }

  const stateRows = db
    .prepare(
      `
        SELECT
          asset_current_state.asset_id,
          asset_current_state.operational_status,
          asset_current_state.custody_status,
          asset_current_state.current_project_id,
          asset_current_state.active_assignment_id,
          asset_current_state.assigned_quantity,
          asset_current_state.checked_out_quantity,
          COALESCE(legacy_rentman_items.current_quantity, 1) AS base_quantity,
          COALESCE((
            SELECT quantity
            FROM asset_assignments
            WHERE asset_assignments.id = asset_current_state.active_assignment_id
              AND asset_assignments.returned_at IS NULL
              AND asset_assignments.assignment_status IN ('reserved', 'assigned', 'checked_out')
            LIMIT 1
          ), 0) AS active_assignment_quantity,
          COALESCE((
            SELECT SUM(quantity)
            FROM packing_slip_items
            WHERE asset_id = asset_current_state.asset_id
              AND returned_at IS NULL
          ), 0) AS open_packing_quantity
        FROM asset_current_state
        LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = asset_current_state.asset_id
        LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
      `,
    )
    .all() as Array<{
      asset_id: string;
      operational_status: string;
      custody_status: string;
      current_project_id: string | null;
      active_assignment_id: string | null;
      assigned_quantity: number;
      checked_out_quantity: number;
      base_quantity: number;
      active_assignment_quantity: number;
      open_packing_quantity: number;
    }>;

  const updateState = db.prepare(
    `
      UPDATE asset_current_state
      SET
        total_quantity = ?,
        available_quantity = ?,
        assigned_quantity = ?,
        checked_out_quantity = ?,
        custody_status = ?
      WHERE asset_id = ?
    `,
  );

  const assignmentRows = db
    .prepare(
      `
        SELECT
          asset_assignments.id,
          asset_assignments.asset_id,
          asset_assignments.assignment_status,
          asset_assignments.returned_at,
          asset_current_state.active_assignment_id,
          asset_current_state.current_project_id,
          asset_current_state.assigned_quantity,
          asset_current_state.checked_out_quantity
        FROM asset_assignments
        JOIN asset_current_state ON asset_current_state.asset_id = asset_assignments.asset_id
      `,
    )
    .all() as Array<{
      id: string;
      asset_id: string;
      assignment_status: string;
      returned_at: string | null;
      active_assignment_id: string | null;
      current_project_id: string | null;
      assigned_quantity: number;
      checked_out_quantity: number;
    }>;

  const updateAssignmentQuantity = db.prepare(
    `
      UPDATE asset_assignments
      SET quantity = ?
      WHERE id = ?
    `,
  );

  stateRows.forEach((row) => {
    const totalQuantity = Math.max(1, row.base_quantity || 1);
    const openPackingQuantity = Math.max(0, Math.min(totalQuantity, row.open_packing_quantity || 0));
    const activeAssignmentQuantity = Math.max(0, Math.min(totalQuantity, row.active_assignment_quantity || 0));
    let availableQuantity = totalQuantity;
    let assignedQuantity = 0;
    let checkedOutQuantity = 0;

    if (openPackingQuantity > 0) {
      checkedOutQuantity = openPackingQuantity;

      if (row.current_project_id && row.active_assignment_id) {
        assignedQuantity = Math.max(0, Math.min(totalQuantity - checkedOutQuantity, activeAssignmentQuantity - checkedOutQuantity));
        availableQuantity = 0;
      } else {
        availableQuantity = Math.max(0, totalQuantity - checkedOutQuantity);
      }
    } else if (row.custody_status === "checked_out") {
      checkedOutQuantity = totalQuantity;
      availableQuantity = 0;
    } else if (row.current_project_id && row.active_assignment_id) {
      assignedQuantity = activeAssignmentQuantity > 0
        ? activeAssignmentQuantity
        : Math.max(0, Math.min(totalQuantity, row.assigned_quantity || 0));
      availableQuantity = Math.max(0, totalQuantity - assignedQuantity);
    } else if (row.custody_status === "assigned" || row.custody_status === "partial_assigned") {
      assignedQuantity = row.custody_status === "assigned"
        ? totalQuantity
        : Math.max(0, Math.min(totalQuantity, row.assigned_quantity || 0));
      availableQuantity = Math.max(0, totalQuantity - assignedQuantity);
    }

    const nextCustodyStatus = deriveCustodyStatus(
      row.operational_status,
      availableQuantity,
      assignedQuantity,
      checkedOutQuantity,
    );

    updateState.run(
      totalQuantity,
      availableQuantity,
      assignedQuantity,
      checkedOutQuantity,
      nextCustodyStatus,
      row.asset_id,
    );
  });

  assignmentRows.forEach((row) => {
    const nextQuantity =
      row.returned_at === null && row.id === row.active_assignment_id
        ? Math.max(1, row.assigned_quantity + row.checked_out_quantity)
        : 1;

    updateAssignmentQuantity.run(nextQuantity, row.id);
  });
};

export const repairAssetCurrentStateFromActiveAssignments = (db: DatabaseSync) => {
  if (
    !hasColumn(db, "asset_current_state", "total_quantity") ||
    !hasColumn(db, "asset_current_state", "assigned_quantity") ||
    !hasColumn(db, "asset_current_state", "checked_out_quantity") ||
    !hasColumn(db, "asset_assignments", "quantity")
  ) {
    return 0;
  }

  const rows = db
    .prepare(
      `
        SELECT
          asset_assignments.id,
          asset_assignments.workspace_id,
          asset_assignments.asset_id,
          asset_assignments.project_id,
          asset_assignments.department_id,
          asset_assignments.project_unit_id,
          asset_assignments.assigned_to_user_id,
          asset_assignments.target_location_id,
          asset_assignments.quantity,
          asset_assignments.assignment_status,
          asset_assignments.updated_at,
          asset_current_state.current_project_id,
          asset_current_state.current_department_id,
          asset_current_state.project_unit_id AS current_project_unit_id,
          asset_current_state.current_responsible_user_id,
          asset_current_state.active_assignment_id,
          asset_current_state.current_location_id,
          asset_current_state.operational_status,
          asset_current_state.custody_status,
          asset_current_state.version,
          asset_current_state.total_quantity,
          asset_current_state.available_quantity,
          asset_current_state.assigned_quantity,
          asset_current_state.checked_out_quantity,
          COALESCE((
            SELECT SUM(quantity)
            FROM packing_slip_items
            WHERE packing_slip_items.asset_id = asset_assignments.asset_id
              AND packing_slip_items.returned_at IS NULL
          ), 0) AS open_packing_quantity
        FROM asset_assignments
        JOIN asset_current_state ON asset_current_state.asset_id = asset_assignments.asset_id
        WHERE asset_assignments.returned_at IS NULL
          AND asset_assignments.project_id IS NOT NULL
          AND asset_assignments.assignment_status IN ('reserved', 'assigned', 'checked_out')
        ORDER BY asset_assignments.asset_id, asset_assignments.updated_at DESC, asset_assignments.created_at DESC
      `,
    )
    .all() as Array<{
      id: string;
      workspace_id: string;
      asset_id: string;
      project_id: string;
      department_id: string | null;
      project_unit_id: string | null;
      assigned_to_user_id: string | null;
      target_location_id: string | null;
      quantity: number;
      assignment_status: string;
      updated_at: string;
      current_project_id: string | null;
      current_department_id: string | null;
      current_project_unit_id: string | null;
      current_responsible_user_id: string | null;
      active_assignment_id: string | null;
      current_location_id: string | null;
      operational_status: string;
      custody_status: string;
      version: number;
      total_quantity: number;
      available_quantity: number;
      assigned_quantity: number;
      checked_out_quantity: number;
      open_packing_quantity: number;
    }>;

  const latestByAsset = new Map<string, (typeof rows)[number]>();
  rows.forEach((row) => {
    if (!latestByAsset.has(row.asset_id)) latestByAsset.set(row.asset_id, row);
  });

  const now = new Date().toISOString();
  const updateState = db.prepare(
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
        version = ?,
        updated_at = ?
      WHERE asset_id = ?
    `,
  );
  const insertOutbox = db.prepare(
    `
      INSERT OR IGNORE INTO sync_outbox (
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
      VALUES (?, ?, 'asset_event', ?, NULL, 'upsert', ?, 'pending', 0, NULL, NULL, ?, ?)
    `,
  );

  let repairedCount = 0;

  latestByAsset.forEach((row) => {
    const totalQuantity = Math.max(1, row.total_quantity || 1);
    const assignmentQuantity = Math.max(1, Math.min(totalQuantity, row.quantity || 1));
    const openPackingQuantity = Math.max(0, Math.min(totalQuantity, row.open_packing_quantity || 0));
    const checkedOutQuantity = row.assignment_status === "checked_out"
      ? Math.max(openPackingQuantity, assignmentQuantity)
      : openPackingQuantity;
    const assignedQuantity = row.assignment_status === "checked_out"
      ? Math.max(0, assignmentQuantity - checkedOutQuantity)
      : Math.max(0, Math.min(totalQuantity - checkedOutQuantity, assignmentQuantity));
    const availableQuantity = Math.max(0, totalQuantity - assignedQuantity - checkedOutQuantity);
    const custodyStatus = deriveCustodyStatus(row.operational_status, availableQuantity, assignedQuantity, checkedOutQuantity);
    const nextLocationId = row.target_location_id ?? row.current_location_id;

    const needsRepair =
      row.current_project_id !== row.project_id ||
      row.current_department_id !== row.department_id ||
      row.current_project_unit_id !== row.project_unit_id ||
      row.current_responsible_user_id !== row.assigned_to_user_id ||
      row.active_assignment_id !== row.id ||
      row.available_quantity !== availableQuantity ||
      row.assigned_quantity !== assignedQuantity ||
      row.checked_out_quantity !== checkedOutQuantity ||
      row.custody_status !== custodyStatus;

    if (!needsRepair) return;

    updateState.run(
      nextLocationId,
      row.project_id,
      row.department_id,
      row.project_unit_id,
      row.assigned_to_user_id,
      row.id,
      availableQuantity,
      assignedQuantity,
      checkedOutQuantity,
      custodyStatus,
      Math.max(1, row.version || 1) + 1,
      now,
      row.asset_id,
    );

    insertOutbox.run(
      `outbox-asset-assignment-state-repair-${row.id}`,
      row.workspace_id,
      row.asset_id,
      JSON.stringify({ kind: "asset_assignment_state_repair", assignmentId: row.id }),
      now,
      now,
    );

    repairedCount += 1;
  });

  return repairedCount;
};
