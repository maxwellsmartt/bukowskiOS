import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("operational-snapshot-service");

export type OperationalSnapshotEntityType = "project" | "packing_slip" | "incident" | "rma_case";

export type RemoteOperationalSnapshotRow = {
  workspace_id: string;
  entity_type: OperationalSnapshotEntityType;
  entity_id: string;
  snapshot_json: Record<string, unknown>;
  updated_at: string;
  deleted_at?: string | null;
};

export type OperationalSnapshotRecord = {
  workspace_id: string;
  entity_type: OperationalSnapshotEntityType;
  entity_id: string;
  snapshot_json: Record<string, unknown>;
  updated_at: string;
  deleted_at: string | null;
};

export const enqueueOperationalSnapshotOutbox = (
  db: DatabaseSync,
  {
    workspaceId,
    entityType,
    entityId,
    operationType = "upsert",
    outboxId,
    payload = {},
    updatedAt,
  }: {
    workspaceId: string;
    entityType: OperationalSnapshotEntityType;
    entityId: string;
    operationType?: string;
    outboxId?: string;
    payload?: Record<string, unknown>;
    updatedAt: string;
  },
) => {
  db
    .prepare(
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
        VALUES (?, ?, ?, ?, NULL, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          status = 'pending',
          last_error = NULL,
          next_retry_at = NULL,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      outboxId ?? `outbox-${entityType}-${entityId}-${updatedAt}`,
      workspaceId,
      entityType,
      entityId,
      operationType,
      JSON.stringify(payload),
      updatedAt,
      updatedAt,
    );
};

type OperationalBackfillEntityResult = {
  entityType: OperationalSnapshotEntityType;
  scannedCount: number;
  enqueuedCount: number;
  skippedCount: number;
};

export type OperationalBackfillResult = {
  workspaceId: string;
  enqueuedCount: number;
  skippedCount: number;
  byEntityType: OperationalBackfillEntityResult[];
};

export type OperationalSnapshotPullResult = {
  workspaceId: string;
  entityType: OperationalSnapshotEntityType;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const entityTables: Record<OperationalSnapshotEntityType, string> = {
  project: "projects",
  packing_slip: "packing_slips",
  incident: "incidents",
  rma_case: "rma_cases",
};

const toJsonObject = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const toSqlInputValue = (value: unknown): SQLInputValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  return JSON.stringify(value);
};

const selectOne = <T extends Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]) =>
  (db.prepare(sql).get(...params) as T | undefined) ?? null;

const selectMany = <T extends Record<string, unknown>>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).all(...params) as T[];

const rowExists = (db: DatabaseSync, table: string, id: unknown) => {
  if (id === null || id === undefined || id === "") return false;
  const row = db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ? LIMIT 1`).get(toSqlInputValue(id)) as
    | { found: number }
    | undefined;
  return Boolean(row);
};

const findEquivalentCrewAssignmentId = (db: DatabaseSync, row: Record<string, unknown>) => {
  if (!row.id || !row.project_unit_id || !row.crew_member_id) return null;
  const existing = db
    .prepare(
      `
        SELECT id
        FROM project_unit_crew_assignments
        WHERE id <> ?
          AND project_unit_id = ?
          AND COALESCE(department_id, '') = COALESCE(?, '')
          AND crew_member_id = ?
          AND COALESCE(start_date, '') = COALESCE(?, '')
          AND COALESCE(end_date, '') = COALESCE(?, '')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(
      toSqlInputValue(row.id),
      toSqlInputValue(row.project_unit_id),
      toSqlInputValue(row.department_id),
      toSqlInputValue(row.crew_member_id),
      toSqlInputValue(row.start_date),
      toSqlInputValue(row.end_date),
    ) as { id: string } | undefined;
  return existing?.id ?? null;
};

const upsertCrewAssignmentRow = (db: DatabaseSync, row: Record<string, unknown>) => {
  const equivalentId = findEquivalentCrewAssignmentId(db, row);
  if (!equivalentId) {
    upsertRow(db, "project_unit_crew_assignments", row);
    return;
  }

  upsertRow(db, "project_unit_crew_assignments", { ...row, id: equivalentId });
  if (row.id && row.id !== equivalentId) {
    db.prepare("DELETE FROM project_unit_crew_assignments WHERE id = ?").run(toSqlInputValue(row.id));
  }
};

const filterRowToTable = (db: DatabaseSync, table: string, row: Record<string, unknown>) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  return Object.fromEntries(Object.entries(row).filter(([key]) => columnNames.has(key)));
};

const upsertRow = (db: DatabaseSync, table: string, row: Record<string, unknown>, conflictColumn = "id") => {
  const filtered = filterRowToTable(db, table, row);
  const entries = Object.entries(filtered);
  if (!entries.length) return;

  const columns = entries.map(([key]) => key);
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== conflictColumn)
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db
    .prepare(
      `
        INSERT INTO ${table} (${columns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates || `${conflictColumn} = excluded.${conflictColumn}`}
      `,
    )
    .run(...entries.map(([, value]) => toSqlInputValue(value)));
};

const upsertRowWithConflict = (db: DatabaseSync, table: string, row: Record<string, unknown>, conflictColumns: string[]) => {
  const filtered = filterRowToTable(db, table, row);
  const entries = Object.entries(filtered);
  if (!entries.length) return;

  const columns = entries.map(([key]) => key);
  const placeholders = columns.map(() => "?").join(", ");
  const conflictTarget = conflictColumns.join(", ");
  const updates = columns.map((column) => `${column} = excluded.${column}`).join(", ");

  db
    .prepare(
      `
        INSERT INTO ${table} (${columns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates}
      `,
    )
    .run(...entries.map(([, value]) => toSqlInputValue(value)));
};

const toRecordArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];

const toStringId = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const deleteRowsMissingFromSnapshot = (
  db: DatabaseSync,
  table: string,
  keyColumn: string,
  scopeWhere: string,
  scopeParams: SQLInputValue[],
  desiredIds: Set<string>,
) => {
  const localRows = selectMany<{ id: string }>(
    db,
    `SELECT ${keyColumn} AS id FROM ${table} WHERE ${scopeWhere}`,
    ...scopeParams,
  );

  for (const row of localRows) {
    if (desiredIds.has(row.id)) continue;
    db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`).run(row.id);
  }
};

const deleteUnitDepartmentsMissingFromSnapshot = (
  db: DatabaseSync,
  localUnitIds: string[],
  desiredPairs: Set<string>,
) => {
  if (!localUnitIds.length) return;
  const placeholders = localUnitIds.map(() => "?").join(", ");
  const localRows = selectMany<{ project_unit_id: string; department_id: string }>(
    db,
    `
      SELECT project_unit_id, department_id
      FROM project_unit_departments
      WHERE project_unit_id IN (${placeholders})
    `,
    ...localUnitIds,
  );

  for (const row of localRows) {
    const pairKey = `${row.project_unit_id}::${row.department_id}`;
    if (desiredPairs.has(pairKey)) continue;
    db
      .prepare("DELETE FROM project_unit_departments WHERE project_unit_id = ? AND department_id = ?")
      .run(row.project_unit_id, row.department_id);
  }
};

const deleteProjectSnapshotLocally = (db: DatabaseSync, projectId: string) => {
  const unitIds = selectMany<{ id: string }>(db, "SELECT id FROM project_units WHERE project_id = ?", projectId).map((row) => row.id);
  if (unitIds.length) {
    const placeholders = unitIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM project_unit_crew_assignments WHERE project_unit_id IN (${placeholders})`).run(...unitIds);
    db.prepare(`DELETE FROM project_unit_departments WHERE project_unit_id IN (${placeholders})`).run(...unitIds);
    db.prepare(`DELETE FROM project_unit_windows WHERE project_unit_id IN (${placeholders})`).run(...unitIds);
  }

  db.prepare("DELETE FROM project_departments WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM project_units WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
};

const deleteOperationalSnapshotLocally = (
  db: DatabaseSync,
  entityType: OperationalSnapshotEntityType,
  entityId: string,
) => {
  if (entityType === "project") {
    deleteProjectSnapshotLocally(db, entityId);
    return;
  }
  if (entityType === "packing_slip") {
    db.prepare("DELETE FROM packing_slip_items WHERE packing_slip_id = ?").run(entityId);
    db.prepare("DELETE FROM packing_slips WHERE id = ?").run(entityId);
    return;
  }
  if (entityType === "incident") {
    db.prepare("DELETE FROM incident_files WHERE incident_id = ?").run(entityId);
    db.prepare("DELETE FROM incidents WHERE id = ?").run(entityId);
    return;
  }
  if (entityType === "rma_case") {
    db.prepare("DELETE FROM rma_case_assets WHERE rma_case_id = ?").run(entityId);
    db.prepare("DELETE FROM rma_cases WHERE id = ?").run(entityId);
  }
};

const hasPendingOutbox = (db: DatabaseSync, workspaceId: string, entityType: OperationalSnapshotEntityType, entityId: string) => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = ?
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, entityType, entityId) as { count: number };
  return row.count > 0;
};

const readLocalUpdatedAt = (
  db: DatabaseSync,
  entityType: OperationalSnapshotEntityType,
  entityId: string,
) => {
  if (entityType === "project") {
    const row = db
      .prepare(
        `
          SELECT MAX(updated_at) AS updated_at
          FROM (
            SELECT updated_at FROM projects WHERE id = ?
            UNION ALL
            SELECT updated_at FROM project_units WHERE project_id = ?
            UNION ALL
            SELECT project_unit_windows.updated_at
            FROM project_unit_windows
            JOIN project_units ON project_units.id = project_unit_windows.project_unit_id
            WHERE project_units.project_id = ?
            UNION ALL
            SELECT project_unit_crew_assignments.updated_at
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            WHERE project_units.project_id = ?
          )
        `,
      )
      .get(entityId, entityId, entityId, entityId) as { updated_at?: string | null } | undefined;
    return row?.updated_at ?? null;
  }

  const table = entityTables[entityType];
  const row = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ? LIMIT 1`).get(entityId) as
    | { updated_at?: string | null }
    | undefined;
  return row?.updated_at ?? null;
};

const updateCursor = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: OperationalSnapshotEntityType,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db
    .prepare(
      `
        INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
          last_synced_at = excluded.last_synced_at,
          last_pulled_count = excluded.last_pulled_count,
          last_error = excluded.last_error,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run(workspaceId, `${entityType}s`, cursorAfter, appliedCount, errorMessage);
};

const shouldSkipBackfillOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: OperationalSnapshotEntityType,
  entityId: string,
  updatedAt: string,
) => {
  const row = db
    .prepare(
      `
        SELECT status
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = ?
          AND entity_id = ?
          AND operation_type = 'snapshot_backfill'
          AND updated_at >= ?
          AND status IN ('pending', 'processing', 'sent')
        LIMIT 1
      `,
    )
    .get(workspaceId, entityType, entityId, updatedAt) as { status: string } | undefined;

  return Boolean(row);
};

const getBackfillCandidates = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: OperationalSnapshotEntityType,
) => {
  if (entityType === "project") {
    return selectMany<{ id: string; updated_at: string }>(
      db,
      `
        SELECT
          projects.id,
          COALESCE(MAX(updated_rows.updated_at), projects.updated_at) AS updated_at
        FROM projects
        LEFT JOIN (
          SELECT project_id, updated_at FROM project_units
          UNION ALL
          SELECT project_units.project_id, project_unit_windows.updated_at
          FROM project_unit_windows
          JOIN project_units ON project_units.id = project_unit_windows.project_unit_id
          UNION ALL
          SELECT project_units.project_id, project_unit_crew_assignments.updated_at
          FROM project_unit_crew_assignments
          JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
        ) AS updated_rows ON updated_rows.project_id = projects.id
        WHERE projects.workspace_id = ?
        GROUP BY projects.id
        ORDER BY updated_at DESC, projects.id
      `,
      workspaceId,
    );
  }

  const table = entityTables[entityType];
  return selectMany<{ id: string; updated_at: string }>(
    db,
    `SELECT id, updated_at FROM ${table} WHERE workspace_id = ? ORDER BY updated_at DESC, id`,
    workspaceId,
  );
};

const resolveProjectSnapshot = (db: DatabaseSync, workspaceId: string, projectId: string) => {
  const project = selectOne(db, "SELECT * FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1", projectId, workspaceId);
  if (!project) return null;
  const units = selectMany(db, "SELECT * FROM project_units WHERE project_id = ? ORDER BY sort_order, name", projectId);
  const unitIds = units.map((unit) => String(unit.id));
  const placeholders = unitIds.map(() => "?").join(", ");

  const crewAssignments = unitIds.length
    ? selectMany(db, `SELECT * FROM project_unit_crew_assignments WHERE project_unit_id IN (${placeholders})`, ...unitIds)
    : [];
  const crewMemberIds = [...new Set(crewAssignments.map((row) => String(row.crew_member_id ?? "")).filter(Boolean))];
  const projectDepartments = selectMany(db, "SELECT * FROM project_departments WHERE project_id = ?", projectId);
  const unitDepartments = unitIds.length
    ? selectMany(db, `SELECT * FROM project_unit_departments WHERE project_unit_id IN (${placeholders})`, ...unitIds)
    : [];
  const departmentIds = [
    ...new Set(
      [...projectDepartments, ...unitDepartments]
        .map((row) => String(row.department_id ?? ""))
        .filter(Boolean),
    ),
  ];

  return {
    project,
    units,
    unitWindows: unitIds.length
      ? selectMany(db, `SELECT * FROM project_unit_windows WHERE project_unit_id IN (${placeholders})`, ...unitIds)
      : [],
    projectDepartments,
    unitDepartments,
    departments: departmentIds.length
      ? selectMany(
          db,
          `SELECT * FROM departments WHERE workspace_id = ? AND id IN (${departmentIds.map(() => "?").join(", ")})`,
          workspaceId,
          ...departmentIds,
        )
      : [],
    crewAssignments,
    crewMembers: crewMemberIds.length
      ? selectMany(
          db,
          `SELECT * FROM crew_members WHERE workspace_id = ? AND id IN (${crewMemberIds.map(() => "?").join(", ")})`,
          workspaceId,
          ...crewMemberIds,
        )
      : [],
  };
};

const resolvePackingSnapshot = (db: DatabaseSync, workspaceId: string, packingSlipId: string) => {
  const slip = selectOne(db, "SELECT * FROM packing_slips WHERE id = ? AND workspace_id = ? LIMIT 1", packingSlipId, workspaceId);
  if (!slip) return null;
  return {
    packingSlip: slip,
    items: selectMany(db, "SELECT * FROM packing_slip_items WHERE packing_slip_id = ? ORDER BY id", packingSlipId),
  };
};

const resolveIncidentSnapshot = (db: DatabaseSync, workspaceId: string, incidentId: string) => {
  const incident = selectOne(db, "SELECT * FROM incidents WHERE id = ? AND workspace_id = ? LIMIT 1", incidentId, workspaceId);
  if (!incident) return null;
  return {
    incident,
    files: selectMany(db, "SELECT * FROM incident_files WHERE incident_id = ? ORDER BY created_at, id", incidentId),
  };
};

const resolveRmaSnapshot = (db: DatabaseSync, workspaceId: string, rmaCaseId: string) => {
  const rmaCase = selectOne(db, "SELECT * FROM rma_cases WHERE id = ? AND workspace_id = ? LIMIT 1", rmaCaseId, workspaceId);
  if (!rmaCase) return null;
  return {
    rmaCase,
    assets: selectMany(db, "SELECT * FROM rma_case_assets WHERE rma_case_id = ? ORDER BY created_at, id", rmaCaseId),
  };
};

export const resolveOperationalSnapshot = (
  db: DatabaseSync,
  row: { workspace_id: string; entity_type: string; entity_id: string; updated_at: string },
): OperationalSnapshotRecord | null => {
  if (!["project", "packing_slip", "incident", "rma_case"].includes(row.entity_type)) {
    return null;
  }

  const entityType = row.entity_type as OperationalSnapshotEntityType;
  const snapshot =
    entityType === "project"
      ? resolveProjectSnapshot(db, row.workspace_id, row.entity_id)
      : entityType === "packing_slip"
        ? resolvePackingSnapshot(db, row.workspace_id, row.entity_id)
        : entityType === "incident"
          ? resolveIncidentSnapshot(db, row.workspace_id, row.entity_id)
          : resolveRmaSnapshot(db, row.workspace_id, row.entity_id);

  if (!snapshot) {
    return {
      workspace_id: row.workspace_id,
      entity_type: entityType,
      entity_id: row.entity_id,
      snapshot_json: {},
      updated_at: row.updated_at,
      deleted_at: row.updated_at,
    };
  }

  return {
    workspace_id: row.workspace_id,
    entity_type: entityType,
    entity_id: row.entity_id,
    snapshot_json: snapshot,
    updated_at: row.updated_at,
    deleted_at: null,
  };
};

const applyProjectSnapshot = (
  db: DatabaseSync,
  snapshot: Record<string, unknown>,
  context: { workspaceId: string; projectId: string },
) => {
  const project = snapshot.project as Record<string, unknown> | undefined;
  if (!project) throw new Error("Project snapshot is missing project.");
  if (project.id !== context.projectId) {
    throw new Error("Project snapshot id does not match the synced entity.");
  }
  if (project.workspace_id !== context.workspaceId) {
    throw new Error("Project snapshot workspace does not match the synced workspace.");
  }

  const safeProject = { ...project };
  if (safeProject.client_id && !rowExists(db, "clients", safeProject.client_id)) {
    throw new Error(`Project references unavailable client ${String(safeProject.client_id)}; snapshot deferred.`);
  }
  if (safeProject.production_company_id && !rowExists(db, "production_companies", safeProject.production_company_id)) {
    throw new Error(`Project references unavailable production company ${String(safeProject.production_company_id)}; snapshot deferred.`);
  }

  const units = toRecordArray(snapshot.units).filter((row) => {
    const belongsToProject = row.project_id === context.projectId;
    const belongsToWorkspace = row.workspace_id === context.workspaceId;
    if (!belongsToProject || !belongsToWorkspace) {
      logger.warn("Skipped remote project unit outside the synced project scope.", { projectId: row.project_id, unitId: row.id });
    }
    return belongsToProject && belongsToWorkspace;
  });
  const snapshotUnitIds = new Set(units.map((row) => toStringId(row.id)).filter((id): id is string => Boolean(id)));
  const localUnitIds = selectMany<{ id: string }>(db, "SELECT id FROM project_units WHERE project_id = ?", context.projectId).map(
    (row) => row.id,
  );
  const scopedUnitIds = new Set([...snapshotUnitIds, ...localUnitIds]);

  const unitWindows = toRecordArray(snapshot.unitWindows).filter((row) => {
    const belongsToProject = snapshotUnitIds.has(String(row.project_unit_id ?? ""));
    if (!belongsToProject) {
      logger.warn("Skipped remote project unit window outside the synced project scope.", {
        projectUnitId: row.project_unit_id,
        windowId: row.id,
      });
    }
    return belongsToProject;
  });
  const projectDepartments = toRecordArray(snapshot.projectDepartments).filter((row) => {
    const belongsToProject = row.project_id === context.projectId;
    if (!belongsToProject) {
      logger.warn("Skipped remote project department outside the synced project scope.", {
        projectId: row.project_id,
        departmentId: row.department_id,
      });
    }
    return belongsToProject;
  });
  const unitDepartments = toRecordArray(snapshot.unitDepartments).filter((row) => {
    const belongsToProject = snapshotUnitIds.has(String(row.project_unit_id ?? ""));
    if (!belongsToProject) {
      logger.warn("Skipped remote project unit department outside the synced project scope.", {
        projectUnitId: row.project_unit_id,
        departmentId: row.department_id,
      });
    }
    return belongsToProject;
  });
  const crewAssignments = toRecordArray(snapshot.crewAssignments).filter((row) => {
    const belongsToProject = snapshotUnitIds.has(String(row.project_unit_id ?? ""));
    const belongsToWorkspace = row.workspace_id === context.workspaceId;
    if (!belongsToProject || !belongsToWorkspace) {
      logger.warn("Skipped remote project crew assignment outside the synced project scope.", {
        projectUnitId: row.project_unit_id,
        assignmentId: row.id,
      });
    }
    return belongsToProject && belongsToWorkspace;
  });
  const crewMembers = toRecordArray(snapshot.crewMembers).filter((row) => row.workspace_id === context.workspaceId);
  const departments = toRecordArray(snapshot.departments).filter((row) => row.workspace_id === context.workspaceId);

  if (Array.isArray(snapshot.crewAssignments) && scopedUnitIds.size) {
    deleteRowsMissingFromSnapshot(
      db,
      "project_unit_crew_assignments",
      "id",
      `project_unit_id IN (${Array.from(scopedUnitIds).map(() => "?").join(", ")})`,
      Array.from(scopedUnitIds),
      new Set(crewAssignments.map((row) => toStringId(row.id)).filter((id): id is string => Boolean(id))),
    );
  }
  if (Array.isArray(snapshot.unitDepartments)) {
    deleteUnitDepartmentsMissingFromSnapshot(
      db,
      localUnitIds,
      new Set(
        unitDepartments
          .map((row) => {
            const unitId = toStringId(row.project_unit_id);
            const departmentId = toStringId(row.department_id);
            return unitId && departmentId ? `${unitId}::${departmentId}` : null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }
  if (Array.isArray(snapshot.unitWindows) && scopedUnitIds.size) {
    deleteRowsMissingFromSnapshot(
      db,
      "project_unit_windows",
      "id",
      `project_unit_id IN (${Array.from(scopedUnitIds).map(() => "?").join(", ")})`,
      Array.from(scopedUnitIds),
      new Set(unitWindows.map((row) => toStringId(row.id)).filter((id): id is string => Boolean(id))),
    );
  }
  if (Array.isArray(snapshot.projectDepartments)) {
    const desiredProjectDepartments = new Set(
      projectDepartments.map((row) => toStringId(row.department_id)).filter((id): id is string => Boolean(id)),
    );
    const localProjectDepartments = selectMany<{ department_id: string }>(
      db,
      "SELECT department_id FROM project_departments WHERE project_id = ?",
      context.projectId,
    );
    for (const row of localProjectDepartments) {
      if (desiredProjectDepartments.has(row.department_id)) continue;
      db.prepare("DELETE FROM project_departments WHERE project_id = ? AND department_id = ?").run(context.projectId, row.department_id);
    }
  }
  if (Array.isArray(snapshot.units)) {
    deleteRowsMissingFromSnapshot(
      db,
      "project_units",
      "id",
      "project_id = ?",
      [context.projectId],
      snapshotUnitIds,
    );
  }

  upsertRow(db, "projects", safeProject);
  for (const row of units) upsertRow(db, "project_units", row);
  for (const row of unitWindows) upsertRow(db, "project_unit_windows", row);
  for (const row of departments) upsertRow(db, "departments", row);
  for (const row of crewMembers) upsertRow(db, "crew_members", row);
  for (const row of projectDepartments) {
    if (!rowExists(db, "departments", row.department_id)) {
      throw new Error(`Project department ${String(row.department_id)} is unavailable; snapshot deferred.`);
    }
    db
      .prepare(
        `
          INSERT OR IGNORE INTO project_departments (project_id, department_id, created_at)
          VALUES (?, ?, ?)
        `,
      )
      .run(toSqlInputValue(row.project_id), toSqlInputValue(row.department_id), toSqlInputValue(row.created_at));
  }
  for (const row of unitDepartments) {
    if (!rowExists(db, "departments", row.department_id)) {
      throw new Error(`Project unit department ${String(row.department_id)} is unavailable; snapshot deferred.`);
    }
    db
      .prepare(
        `
          INSERT OR IGNORE INTO project_unit_departments (project_unit_id, department_id, created_at)
          VALUES (?, ?, ?)
        `,
      )
      .run(toSqlInputValue(row.project_unit_id), toSqlInputValue(row.department_id), toSqlInputValue(row.created_at));
  }
  for (const row of crewAssignments) {
    try {
      if (!rowExists(db, "crew_members", row.crew_member_id)) {
        const crewId = String(row.crew_member_id ?? "");
        if (!crewId) throw new Error("Crew assignment has no crew member id.");
        const updatedAt = String(row.updated_at ?? safeProject.updated_at ?? new Date().toISOString());
        db.prepare(
          `INSERT OR IGNORE INTO crew_members (
             id, workspace_id, full_name, role_label, email, phone, notes, is_active, created_at, updated_at
           ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 1, ?, ?)`
        ).run(
          crewId,
          context.workspaceId,
          `Remote crew ${crewId.slice(-6) || crewId}`,
          "Created from a project snapshot; the crew catalog will hydrate the full record.",
          updatedAt,
          updatedAt,
        );
      }
      upsertCrewAssignmentRow(db, row);
    } catch {
      logger.warn("Skipped remote project crew assignment because related crew is unavailable.", { id: row.id });
    }
  }
};

const applyPackingSnapshot = (db: DatabaseSync, snapshot: Record<string, unknown>) => {
  const slip = snapshot.packingSlip as Record<string, unknown> | undefined;
  if (!slip) throw new Error("Packing snapshot is missing packingSlip.");
  const projectId = slip.project_id;
  const projectUnitId = slip.project_unit_id;
  if (projectId && !rowExists(db, "projects", projectId)) {
    throw new Error(`Packing snapshot references unavailable project ${String(projectId)}.`);
  }
  if (projectUnitId && !rowExists(db, "project_units", projectUnitId)) {
    throw new Error(`Packing snapshot references unavailable project unit ${String(projectUnitId)}.`);
  }

  const safeSlip = { ...slip };
  if (safeSlip.department_id && !rowExists(db, "departments", safeSlip.department_id)) {
    logger.warn("Applied remote packing slip without missing department reference.", {
      id: safeSlip.id,
      departmentId: safeSlip.department_id,
    });
    safeSlip.department_id = null;
  }
  for (const userColumn of ["prepared_by_user_id", "approved_by_user_id", "responsible_user_id"]) {
    if (safeSlip[userColumn] && !rowExists(db, "users", safeSlip[userColumn])) {
      logger.warn("Applied remote packing slip without missing user reference.", {
        id: safeSlip.id,
        userColumn,
        userId: safeSlip[userColumn],
      });
      safeSlip[userColumn] = userColumn === "prepared_by_user_id" ? "user-ops" : null;
    }
  }

  upsertRow(db, "packing_slips", safeSlip);
  for (const row of (snapshot.items as Record<string, unknown>[] | undefined) ?? []) {
    if (!rowExists(db, "assets", row.asset_id)) {
      logger.warn("Skipped remote packing item because related asset is unavailable.", {
        packingSlipId: row.packing_slip_id,
        assetId: row.asset_id,
      });
      continue;
    }
    upsertRowWithConflict(db, "packing_slip_items", row, ["packing_slip_id", "asset_id"]);
  }
};

const applyIncidentSnapshot = (db: DatabaseSync, snapshot: Record<string, unknown>) => {
  const incident = snapshot.incident as Record<string, unknown> | undefined;
  if (!incident) throw new Error("Incident snapshot is missing incident.");
  upsertRow(db, "incidents", incident);
  for (const row of (snapshot.files as Record<string, unknown>[] | undefined) ?? []) upsertRow(db, "incident_files", row);
};

const applyRmaSnapshot = (db: DatabaseSync, snapshot: Record<string, unknown>) => {
  const rmaCase = snapshot.rmaCase as Record<string, unknown> | undefined;
  if (!rmaCase) throw new Error("RMA snapshot is missing rmaCase.");
  upsertRow(db, "rma_cases", rmaCase);
  for (const row of (snapshot.assets as Record<string, unknown>[] | undefined) ?? []) upsertRow(db, "rma_case_assets", row);
};

export const createOperationalSnapshotService = (db: DatabaseSync) => ({
  enqueueBackfill(workspaceId: string): OperationalBackfillResult {
    const entityTypes: OperationalSnapshotEntityType[] = ["project", "packing_slip", "incident", "rma_case"];
    const result: OperationalBackfillResult = {
      workspaceId,
      enqueuedCount: 0,
      skippedCount: 0,
      byEntityType: [],
    };

    db.exec("BEGIN");
    try {
      for (const entityType of entityTypes) {
        const candidates = getBackfillCandidates(db, workspaceId, entityType);
        const entityResult: OperationalBackfillEntityResult = {
          entityType,
          scannedCount: candidates.length,
          enqueuedCount: 0,
          skippedCount: 0,
        };

        for (const candidate of candidates) {
          const updatedAt = candidate.updated_at || new Date().toISOString();
          if (shouldSkipBackfillOutbox(db, workspaceId, entityType, candidate.id, updatedAt)) {
            entityResult.skippedCount += 1;
            continue;
          }

          enqueueOperationalSnapshotOutbox(db, {
            workspaceId,
            entityType,
            entityId: candidate.id,
            operationType: "snapshot_backfill",
            outboxId: `outbox-snapshot-backfill-${entityType}-${candidate.id}-${updatedAt}`,
            payload: { source: "operational_snapshot_backfill" },
            updatedAt,
          });
          entityResult.enqueuedCount += 1;
        }

        result.enqueuedCount += entityResult.enqueuedCount;
        result.skippedCount += entityResult.skippedCount;
        result.byEntityType.push(entityResult);
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown operational snapshot backfill error.";
      logger.error("Operational snapshot backfill transaction rolled back.", { workspaceId, error: message });
      throw new Error(message);
    }

    logger.info("Operational snapshot backfill queued.", result);
    return result;
  },
  applyRemoteSnapshots(
    workspaceId: string,
    entityType: OperationalSnapshotEntityType,
    rows: RemoteOperationalSnapshotRow[],
  ): OperationalSnapshotPullResult {
    const result: OperationalSnapshotPullResult = {
      workspaceId,
      entityType,
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      skippedDueToOlderCount: 0,
      errors: [],
      cursorAfter: null,
    };

    db.exec("BEGIN");
    try {
      for (const row of rows) {
        if (row.workspace_id !== workspaceId || row.entity_type !== entityType) continue;

        if (hasPendingOutbox(db, workspaceId, entityType, row.entity_id)) {
          result.skippedDueToOutboxCount += 1;
          result.cursorAfter = row.updated_at;
          continue;
        }

        const localUpdatedAt = readLocalUpdatedAt(db, entityType, row.entity_id);
        if (localUpdatedAt && localUpdatedAt >= row.updated_at) {
          result.skippedDueToOlderCount += 1;
          result.cursorAfter = row.updated_at;
          continue;
        }

        try {
          if (row.deleted_at) {
            deleteOperationalSnapshotLocally(db, entityType, row.entity_id);
            result.appliedCount += 1;
            result.cursorAfter = row.updated_at;
            continue;
          }

          if (entityType === "project") applyProjectSnapshot(db, row.snapshot_json, {
            workspaceId: row.workspace_id,
            projectId: row.entity_id,
          });
          if (entityType === "packing_slip") applyPackingSnapshot(db, row.snapshot_json);
          if (entityType === "incident") applyIncidentSnapshot(db, row.snapshot_json);
          if (entityType === "rma_case") applyRmaSnapshot(db, row.snapshot_json);
          result.appliedCount += 1;
          result.cursorAfter = row.updated_at;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown operational snapshot error.";
          result.errors.push(`${row.entity_id}: ${message}`);
          logger.warn("Operational snapshot row failed.", { entityType, id: row.entity_id, error: message });
        }
      }

      updateCursor(db, workspaceId, entityType, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown operational snapshot pull error.";
      result.errors.push(message);
      logger.error("Operational snapshot pull transaction rolled back.", { entityType, error: message });
    }

    return result;
  },
  resolveSnapshot(row: { workspace_id: string; entity_type: string; entity_id: string; updated_at: string }) {
    return resolveOperationalSnapshot(db, row);
  },
  readLocalUpdatedAt(entityType: OperationalSnapshotEntityType, entityId: string) {
    return readLocalUpdatedAt(db, entityType, entityId);
  },
});

export const maybeParseOperationalSnapshot = (row: RemoteOperationalSnapshotRow) => ({
  ...row,
  snapshot_json:
    typeof row.snapshot_json === "string"
      ? (toJsonObject(row.snapshot_json) ?? {})
      : row.snapshot_json,
});
