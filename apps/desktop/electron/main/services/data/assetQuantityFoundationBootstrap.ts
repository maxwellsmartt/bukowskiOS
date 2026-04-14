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
          COALESCE(legacy_rentman_items.current_quantity, 1) AS base_quantity,
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
      base_quantity: number;
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
    let availableQuantity = totalQuantity;
    let assignedQuantity = 0;
    let checkedOutQuantity = 0;

    if (openPackingQuantity > 0) {
      checkedOutQuantity = openPackingQuantity;

      if (row.current_project_id && row.custody_status === "assigned") {
        assignedQuantity = Math.max(0, totalQuantity - checkedOutQuantity);
        availableQuantity = 0;
      } else {
        availableQuantity = Math.max(0, totalQuantity - checkedOutQuantity);
      }
    } else if (row.custody_status === "checked_out") {
      checkedOutQuantity = totalQuantity;
      availableQuantity = 0;
    } else if (row.custody_status === "assigned") {
      assignedQuantity = totalQuantity;
      availableQuantity = 0;
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
