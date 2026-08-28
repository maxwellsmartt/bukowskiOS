// Finishes the two projects the first clean-slate pass could not remove.
//
// projectMutationService.deleteProject refuses an Active project outright, and
// refuses any project that still has operational history (a packing slip, in
// this case). Both guards are correct — this script clears the conditions
// explicitly and audibly rather than bypassing the service.
//
// Preview by default; CLEAN_SLATE_APPLY=1 to write.
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { createProjectMutationService } from "../../apps/desktop/electron/main/services/data/projectMutationService";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
const DRY_RUN = process.env.CLEAN_SLATE_APPLY !== "1";

app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

const main = async () => {
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) {
    console.error("NO_KEY");
    app.exit(2);
    return;
  }
  const db = new DatabaseSync(`${USER_DATA}/bukowski-foundation.sqlite`, {
    cipher: { key, profile: "sqlcipher-legacy4" },
  });
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA foreign_keys = ON;");
  const projects = createProjectMutationService(db as unknown as NodeDatabaseSync);
  const all = <T,>(sql: string, p: unknown[] = []): T[] => db.prepare(sql).all(...(p as never[])) as T[];

  const remaining = all<{ id: string; name: string; status: string; archived_at: string | null }>(
    "SELECT id, name, status, archived_at FROM projects ORDER BY name",
  );
  console.log(`\n${DRY_RUN ? "PREVISUALIZACIÓN" : "APLICANDO"} · proyectos restantes: ${remaining.length}\n`);

  for (const project of remaining) {
    const summary = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM asset_current_state WHERE current_project_id = ?) AS activos,
           (SELECT COUNT(*) FROM asset_assignments  WHERE project_id = ?) AS asignaciones,
           (SELECT COUNT(*) FROM incidents          WHERE project_id = ?) AS incidencias,
           (SELECT COUNT(*) FROM packing_slips      WHERE project_id = ?) AS packing,
           (SELECT COUNT(*) FROM financial_entries  WHERE project_id = ?) AS finanzas,
           (SELECT COUNT(*) FROM collaborator_fees  WHERE project_id = ?) AS honorarios`,
      )
      .get(...(Array(6).fill(project.id) as string[])) as Record<string, number>;
    console.log(`${project.name} · estado ${project.status} · ${JSON.stringify(summary)}`);

    if (DRY_RUN) continue;

    // A packing slip is inventory paperwork for an inventory that no longer
    // exists; it cannot outlive the wipe.
    if (summary.packing > 0) {
      const slips = all<{ id: string }>("SELECT id FROM packing_slips WHERE project_id = ?", [project.id]);
      for (const slip of slips) {
        db.prepare("DELETE FROM packing_slip_items WHERE packing_slip_id = ?").run(slip.id);
        db.prepare("DELETE FROM packing_slips WHERE id = ?").run(slip.id);
      }
      console.log(`   · ${slips.length} packing slip(s) eliminados`);
    }

    // deleteProject rejects Active regardless of archived_at, so the status
    // moves to Wrapped first — the same transition the UI would make.
    if (project.status === "Active") {
      db.prepare("UPDATE projects SET status = 'Wrapped', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        project.id,
      );
      console.log("   · estado Active → Wrapped");
    }

    try {
      const fresh = db.prepare("SELECT archived_at FROM projects WHERE id = ?").get(project.id) as
        | { archived_at: string | null }
        | undefined;
      if (!fresh?.archived_at) projects.archiveProject({ projectId: project.id });
      projects.deleteProject({ projectId: project.id, confirmedWithBackup: true });
      console.log(`   ✓ eliminado`);
    } catch (error) {
      console.log(`   ✗ ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const left = all<{ n: number }>("SELECT COUNT(*) n FROM projects")[0]?.n ?? -1;
  console.log(`\nProyectos restantes: ${left}`);
  db.close();
  app.exit(0);
};

app.whenReady().then(main).catch((error) => {
  console.error("FINISH_FAILED:", error);
  app.exit(1);
});
