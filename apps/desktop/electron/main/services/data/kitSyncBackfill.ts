import type { DatabaseSync } from "node:sqlite";

// One-time backfill: Kits gained their Supabase mirror after some machines had
// already created local kits. New create/update/delete operations already enqueue
// `kit` outbox rows; this catches pre-existing local kits so they can sync to
// other machines without direct DB surgery.

const enqueueKitUpsert = (db: DatabaseSync, workspaceId: string, kitId: string, now: string) => {
  db.prepare(
    `INSERT OR IGNORE INTO sync_outbox (
       id, workspace_id, entity_type, entity_id, operation_type,
       payload_json, status, attempt_count, last_error, next_retry_at,
       created_at, updated_at
     ) VALUES (?, ?, 'kit', ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)`,
  ).run(`backfill-kit-${kitId}`, workspaceId, kitId, JSON.stringify({ id: kitId }), now, now, now);
};

// Only real (Supabase-backed) workspaces sync: their ids are uuids (36 chars).
// The seed/demo workspace ("workspace-metadata") is local-only — pushing it
// fails because the remote mirror has a uuid FK for workspace_id.
const isSyncableWorkspaceId = (workspaceId: string) => workspaceId.length === 36 && workspaceId.split("-").length === 5;

export const backfillKitSyncOutbox = (db: DatabaseSync) => {
  const now = new Date().toISOString();
  const kits = db.prepare("SELECT id, workspace_id FROM kits").all() as Array<{ id: string; workspace_id: string }>;

  for (const row of kits) {
    if (!isSyncableWorkspaceId(row.workspace_id)) continue;

    // Bump updated_at so this machine's authoritative local kit wins over any
    // older remote placeholder/state if last-writer-wins reconciliation runs.
    db.prepare("UPDATE kits SET updated_at = ? WHERE id = ?").run(now, row.id);
    enqueueKitUpsert(db, row.workspace_id, row.id, now);
  }
};

// Cleanup for any earlier/local experiments that may have enqueued seed/demo
// kits. These rows can never push successfully to Supabase and would keep the
// sync queue noisy with invalid uuid workspace errors.
export const cleanupSeedKitOutbox = (db: DatabaseSync) => {
  db.prepare(
    `
      DELETE FROM sync_outbox
      WHERE entity_type = 'kit'
        AND (length(workspace_id) != 36 OR workspace_id NOT LIKE '%-%-%-%-%')
    `,
  ).run();
};
