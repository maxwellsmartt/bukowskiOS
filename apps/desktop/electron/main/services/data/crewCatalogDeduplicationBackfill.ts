import type { DatabaseSync } from "node:sqlite";

const PLACEHOLDER_NOTE_PREFIX = "Created locally during collaborator payment sync";

const isSyncableWorkspaceId = (workspaceId: string) => workspaceId.length === 36 && workspaceId.split("-").length === 5;

const normalizeCrewNameKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const tableExists = (db: DatabaseSync, tableName: string) => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
};

const columnExists = (db: DatabaseSync, tableName: string, columnName: string) =>
  tableExists(db, tableName) &&
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some((row) => row.name === columnName);

const enqueueOutbox = (
  db: DatabaseSync,
  input: {
    id: string;
    workspaceId: string;
    entityType: string;
    entityId: string;
    operationType: "upsert" | "delete";
    payload: Record<string, unknown>;
    now: string;
  },
) => {
  if (!isSyncableWorkspaceId(input.workspaceId)) return;

  db.prepare(
    `INSERT OR IGNORE INTO sync_outbox (
       id, workspace_id, entity_type, entity_id, operation_type,
       payload_json, status, attempt_count, last_error, next_retry_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?)`,
  ).run(
    input.id,
    input.workspaceId,
    input.entityType,
    input.entityId,
    input.operationType,
    JSON.stringify(input.payload),
    input.now,
    input.now,
    input.now,
  );
};

type CrewRow = {
  id: string;
  workspace_id: string;
  full_name: string;
  linked_user_id: string | null;
  primary_department_id: string | null;
  notes: string | null;
  created_at: string;
};

const chooseCanonicalCrew = (rows: CrewRow[]) =>
  [...rows].sort((left, right) => {
    const leftScore = (left.linked_user_id ? 4 : 0) + (left.primary_department_id ? 2 : 0) + (left.notes ? 1 : 0);
    const rightScore = (right.linked_user_id ? 4 : 0) + (right.primary_department_id ? 2 : 0) + (right.notes ? 1 : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    const createdCompare = left.created_at.localeCompare(right.created_at);
    if (createdCompare !== 0) return createdCompare;
    return left.id.localeCompare(right.id);
  })[0]!;

export const deduplicateCrewCatalog = (db: DatabaseSync) => {
  const now = new Date().toISOString();
  const crewRows = db
    .prepare(
      `
        SELECT id, workspace_id, full_name, linked_user_id, primary_department_id, notes, created_at
        FROM crew_members
        WHERE COALESCE(full_name, '') != ''
          AND COALESCE(notes, '') NOT LIKE '${PLACEHOLDER_NOTE_PREFIX}%'
          AND COALESCE(full_name, '') NOT LIKE 'Remote collaborator %'
        ORDER BY workspace_id, full_name, created_at, id
      `,
    )
    .all() as CrewRow[];

  const groups = new Map<string, CrewRow[]>();
  for (const row of crewRows) {
    const key = `${row.workspace_id}::${normalizeCrewNameKey(row.full_name)}`;
    if (key.endsWith("::")) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let mergedCrewCount = 0;
  const affectedProjectIdsByWorkspace = new Map<string, Set<string>>();

  db.exec("BEGIN");
  try {
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      const linkedUserIds = new Set(rows.map((row) => row.linked_user_id).filter((value): value is string => Boolean(value)));
      if (linkedUserIds.size > 1) continue;

      const canonical = chooseCanonicalCrew(rows);
      const duplicates = rows.filter((row) => row.id !== canonical.id);
      if (!duplicates.length) continue;

      const duplicateIds = duplicates.map((row) => row.id);
      const placeholders = duplicateIds.map(() => "?").join(", ");
      const affectedProjects = db
        .prepare(
          `
            SELECT DISTINCT project_units.project_id AS project_id
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            WHERE project_unit_crew_assignments.crew_member_id IN (${placeholders})
          `,
        )
        .all(...duplicateIds) as Array<{ project_id: string }>;

      const affectedSet = affectedProjectIdsByWorkspace.get(canonical.workspace_id) ?? new Set<string>();
      affectedProjects.forEach((row) => affectedSet.add(row.project_id));
      affectedProjectIdsByWorkspace.set(canonical.workspace_id, affectedSet);

      const duplicateWithLinkedUser = duplicates.find((row) => row.linked_user_id);
      if (!canonical.linked_user_id && duplicateWithLinkedUser?.linked_user_id) {
        db.prepare("UPDATE crew_members SET linked_user_id = ?, updated_at = ? WHERE id = ?").run(
          duplicateWithLinkedUser.linked_user_id,
          now,
          canonical.id,
        );
      } else {
        db.prepare("UPDATE crew_members SET updated_at = ? WHERE id = ?").run(now, canonical.id);
      }

      db.prepare(`UPDATE project_unit_crew_assignments SET crew_member_id = ?, updated_at = ? WHERE crew_member_id IN (${placeholders})`).run(
        canonical.id,
        now,
        ...duplicateIds,
      );

      if (columnExists(db, "collaborator_fees", "crew_member_id")) {
        const feeTimestampClause = columnExists(db, "collaborator_fees", "updated_at") ? ", updated_at = ?" : "";
        db.prepare(`UPDATE collaborator_fees SET crew_member_id = ?${feeTimestampClause} WHERE crew_member_id IN (${placeholders})`).run(
          ...(feeTimestampClause ? [canonical.id, now, ...duplicateIds] : [canonical.id, ...duplicateIds]),
        );
      }

      if (tableExists(db, "crew_documents")) {
        db.prepare(`UPDATE crew_documents SET crew_member_id = ? WHERE crew_member_id IN (${placeholders})`).run(canonical.id, ...duplicateIds);
      }

      if (tableExists(db, "crew_bank_accounts")) {
        db.prepare(`UPDATE crew_bank_accounts SET crew_member_id = ?, updated_at = ? WHERE crew_member_id IN (${placeholders})`).run(
          canonical.id,
          now,
          ...duplicateIds,
        );
      }

      db.prepare(
        `
          DELETE FROM project_unit_crew_assignments
          WHERE rowid NOT IN (
            SELECT MIN(rowid)
            FROM project_unit_crew_assignments
            GROUP BY
              workspace_id,
              project_unit_id,
              crew_member_id,
              COALESCE(department_id, ''),
              COALESCE(role_label, ''),
              COALESCE(start_date, ''),
              COALESCE(end_date, '')
          )
        `,
      ).run();

      for (const duplicate of duplicates) {
        db.prepare("DELETE FROM crew_members WHERE id = ?").run(duplicate.id);
        enqueueOutbox(db, {
          id: `crew-dedupe-delete-${duplicate.id}`,
          workspaceId: duplicate.workspace_id,
          entityType: "crew",
          entityId: duplicate.id,
          operationType: "delete",
          payload: { id: duplicate.id, source: "crew_catalog_deduplication" },
          now,
        });
        mergedCrewCount += 1;
      }

      enqueueOutbox(db, {
        id: `crew-dedupe-upsert-${canonical.id}`,
        workspaceId: canonical.workspace_id,
        entityType: "crew",
        entityId: canonical.id,
        operationType: "upsert",
        payload: { id: canonical.id, source: "crew_catalog_deduplication" },
        now,
      });
    }

    for (const [workspaceId, projectIds] of affectedProjectIdsByWorkspace.entries()) {
      for (const projectId of projectIds) {
        enqueueOutbox(db, {
          id: `crew-dedupe-project-${projectId}-${now}`,
          workspaceId,
          entityType: "project",
          entityId: projectId,
          operationType: "upsert",
          payload: { projectId, operation: "crew_deduplicate", source: "crew_catalog_deduplication" },
          now,
        });
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return mergedCrewCount;
};
