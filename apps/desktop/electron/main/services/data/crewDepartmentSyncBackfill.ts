import type { DatabaseSync } from "node:sqlite";

// One-time backfill: when crew_members + departments gained their Supabase
// mirror, existing local rows had never been enqueued (the catalog outbox only
// fires on create/update/delete). Without this, a machine's existing crew and
// departments would never push, so project crew/department links keep getting
// dropped on the other machine ("related crew/department is unavailable").
//
// Placeholder crew (created by ensureCrewMember during collaborator payment
// sync — fake "Remote collaborator XXX" names) are intentionally NOT pushed:
// they are FK stubs, not authoritative data. We also bump real crew
// updated_at to now() so the authoritative push wins last-writer-wins over any
// stale placeholder another machine may have already mirrored.

const PLACEHOLDER_NOTE_PREFIX = "Created locally during collaborator payment sync";

const enqueueUpsert = (db: DatabaseSync, workspaceId: unknown, entityType: string, entityId: string, now: string) => {
  db.prepare(
    `INSERT OR IGNORE INTO sync_outbox (
       id, workspace_id, entity_type, entity_id, operation_type,
       payload_json, status, attempt_count, last_error, next_retry_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)`,
  ).run(
    `backfill-${entityType}-${entityId}`,
    workspaceId as string,
    entityType,
    entityId,
    JSON.stringify({ id: entityId }),
    now,
    now,
    now,
  );
};

// Only real (Supabase-backed) workspaces sync: their ids are uuids (36 chars).
// The seed/demo workspace ("workspace-metadata") is local-only — pushing its
// rows fails with `invalid input syntax for type uuid` because the mirror's
// workspace_id is a uuid FK and no such remote workspace exists.
const isSyncableWorkspaceId = (workspaceId: string) => workspaceId.length === 36 && workspaceId.split("-").length === 5;

export const backfillCrewDepartmentSyncOutbox = (db: DatabaseSync) => {
  const now = new Date().toISOString();

  const crew = db
    .prepare(
      `
        SELECT id, workspace_id
        FROM crew_members
        WHERE COALESCE(notes, '') NOT LIKE '${PLACEHOLDER_NOTE_PREFIX}%'
          AND COALESCE(full_name, '') NOT LIKE 'Remote collaborator %'
      `,
    )
    .all() as Array<{ id: string; workspace_id: string }>;

  for (const row of crew) {
    if (!isSyncableWorkspaceId(row.workspace_id)) continue;
    db.prepare("UPDATE crew_members SET updated_at = ? WHERE id = ?").run(now, row.id);
    enqueueUpsert(db, row.workspace_id, "crew", row.id, now);
  }

  const departments = db
    .prepare("SELECT id, workspace_id FROM departments")
    .all() as Array<{ id: string; workspace_id: string }>;

  for (const row of departments) {
    if (!isSyncableWorkspaceId(row.workspace_id)) continue;
    enqueueUpsert(db, row.workspace_id, "department", row.id, now);
  }
};

// One-time cleanup for machines that ran the first backfill (v1) before the
// uuid-workspace filter existed: drop the crew/department outbox rows for the
// seed/demo workspace that can never push (invalid uuid workspace_id).
export const cleanupSeedCrewDepartmentOutbox = (db: DatabaseSync) => {
  db.prepare(
    `
      DELETE FROM sync_outbox
      WHERE entity_type IN ('crew', 'department')
        AND (length(workspace_id) != 36 OR workspace_id NOT LIKE '%-%-%-%-%')
    `,
  ).run();
};
