import type { DatabaseSync } from "node:sqlite";

import type { ProjectColorKey } from "@contracts";

import { assertDateWindow, deriveProjectUnitStatus } from "./projectScheduling";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const seededProjects: Array<{
  id: string;
  colorKey: ProjectColorKey;
  startDate: string | null;
  endDate: string | null;
  units: Array<{
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    colorKey: ProjectColorKey | null;
    startDate: string | null;
    endDate: string | null;
    notes: string;
    crewAssignments?: Array<{
      id: string;
      crewMemberId: string;
      roleLabel: string;
      startDate: string | null;
      endDate: string | null;
      notes: string;
    }>;
  }>;
}> = [
  {
    id: "project-aurora",
    colorKey: "ice",
    startDate: "2026-04-01",
    endDate: "2026-04-18",
    units: [
      {
        id: "unit-aurora-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-04-01",
        endDate: "2026-04-18",
        notes: "Primary photography and camera coverage.",
        crewAssignments: [
          {
            id: "unit-aurora-main-crew-paola",
            crewMemberId: "crew-user-paola",
            roleLabel: "Camera lead",
            startDate: "2026-04-01",
            endDate: "2026-04-18",
            notes: "Core camera follow-up.",
          },
          {
            id: "unit-aurora-main-crew-luis",
            crewMemberId: "crew-user-luis",
            roleLabel: "Video assist",
            startDate: "2026-04-03",
            endDate: "2026-04-18",
            notes: "Video village coverage.",
          },
        ],
      },
      {
        id: "unit-aurora-second",
        code: "2ND",
        name: "Second Unit",
        sortOrder: 2,
        colorKey: "teal",
        startDate: "2026-04-10",
        endDate: "2026-04-14",
        notes: "Parallel pickup days.",
        crewAssignments: [
          {
            id: "unit-aurora-second-crew-miguel",
            crewMemberId: "crew-user-miguel",
            roleLabel: "B unit support",
            startDate: "2026-04-10",
            endDate: "2026-04-14",
            notes: "Secondary field support.",
          },
        ],
      },
    ],
  },
  {
    id: "project-studio",
    colorKey: "amber",
    startDate: "2026-04-10",
    endDate: "2026-04-15",
    units: [
      {
        id: "unit-studio-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-04-10",
        endDate: "2026-04-15",
        notes: "Studio prep and tests.",
        crewAssignments: [
          {
            id: "unit-studio-main-crew-paola",
            crewMemberId: "crew-user-paola",
            roleLabel: "Prep lead",
            startDate: "2026-04-10",
            endDate: "2026-04-15",
            notes: "Internal prep lead.",
          },
        ],
      },
    ],
  },
  {
    id: "project-house",
    colorKey: "steel",
    startDate: "2026-04-03",
    endDate: "2026-04-09",
    units: [
      {
        id: "unit-house-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-04-03",
        endDate: "2026-04-09",
        notes: "Closed internal testing unit.",
      },
    ],
  },
  {
    id: "project-archipielago",
    colorKey: "moss",
    startDate: "2026-04-22",
    endDate: "2026-05-20",
    units: [
      {
        id: "unit-arch-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-04-22",
        endDate: "2026-05-20",
        notes: "Main production block.",
      },
      {
        id: "unit-arch-splinter",
        code: "SPL",
        name: "Splinter Unit",
        sortOrder: 2,
        colorKey: "copper",
        startDate: "2026-05-02",
        endDate: "2026-05-08",
        notes: "Short splinter days for inserts.",
      },
    ],
  },
  {
    id: "project-oar-netflix",
    colorKey: "rose",
    startDate: "2026-04-12",
    endDate: "2026-04-30",
    units: [
      {
        id: "unit-oar-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-04-12",
        endDate: "2026-04-30",
        notes: "Main shoot window.",
      },
      {
        id: "unit-oar-second",
        code: "2ND",
        name: "Second Unit",
        sortOrder: 2,
        colorKey: "violet",
        startDate: "2026-04-20",
        endDate: "2026-04-24",
        notes: "Secondary coverage during overlap.",
      },
    ],
  },
  {
    id: "project-shiver",
    colorKey: "teal",
    startDate: null,
    endDate: null,
    units: [],
  },
  {
    id: "project-a-thousand-blows",
    colorKey: "coral",
    startDate: "2026-05-04",
    endDate: "2026-06-10",
    units: [
      {
        id: "unit-atb-main",
        code: "MAIN",
        name: "Main Unit",
        sortOrder: 1,
        colorKey: null,
        startDate: "2026-05-04",
        endDate: "2026-06-10",
        notes: "Main series unit.",
      },
    ],
  },
];

export const applySchedulingFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "projects", "color_key")) {
    db.exec("ALTER TABLE projects ADD COLUMN color_key TEXT;");
  }

  if (!hasColumn(db, "crew_members", "linked_user_id")) {
    db.exec("ALTER TABLE crew_members ADD COLUMN linked_user_id TEXT REFERENCES users(id);");
  }

  if (!hasColumn(db, "asset_assignments", "project_unit_id")) {
    db.exec("ALTER TABLE asset_assignments ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }

  if (!hasColumn(db, "asset_current_state", "project_unit_id")) {
    db.exec("ALTER TABLE asset_current_state ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }

  if (!hasColumn(db, "packing_slips", "project_unit_id")) {
    db.exec("ALTER TABLE packing_slips ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }

  if (!hasColumn(db, "incidents", "project_unit_id")) {
    db.exec("ALTER TABLE incidents ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }

  if (!hasColumn(db, "financial_entries", "project_unit_id")) {
    db.exec("ALTER TABLE financial_entries ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }

  if (!hasColumn(db, "collaborator_fees", "project_unit_id")) {
    db.exec("ALTER TABLE collaborator_fees ADD COLUMN project_unit_id TEXT REFERENCES project_units(id);");
  }
};

const resolvePrimaryUnitId = (db: DatabaseSync, projectId: string) => {
  const row = db
    .prepare(
      `
        SELECT id
        FROM project_units
        WHERE project_id = ?
        ORDER BY sort_order, start_date, name
        LIMIT 1
      `,
    )
    .get(projectId) as { id: string } | undefined;

  return row?.id ?? null;
};

export const bootstrapSchedulingFoundation = (db: DatabaseSync) => {
  applySchedulingFoundationMigration(db);

  const now = new Date().toISOString();

  db.exec("BEGIN");

  try {
    const crewMembers = db
      .prepare("SELECT id FROM crew_members WHERE workspace_id = ?")
      .all(workspaceId) as Array<{ id: string }>;

    const crewIds = new Set(crewMembers.map((row) => row.id));

    db.prepare(
      `
        UPDATE crew_members
        SET linked_user_id = replace(id, 'crew-', '')
        WHERE workspace_id = ?
          AND linked_user_id IS NULL
          AND id LIKE 'crew-user-%'
      `,
    ).run(workspaceId);

    seededProjects.forEach((project) => {
      const existingProject = db.prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").get(project.id) as { id: string } | undefined;

      if (!existingProject) {
        return;
      }

      assertDateWindow(project.startDate, project.endDate, `${project.id} schedule`);

      db.prepare(
        `
          UPDATE projects
          SET color_key = COALESCE(color_key, ?),
              start_date = COALESCE(start_date, ?),
              end_date = COALESCE(end_date, ?)
          WHERE id = ?
        `,
      ).run(project.colorKey, project.startDate, project.endDate, project.id);

      project.units.forEach((unit) => {
        assertDateWindow(unit.startDate, unit.endDate, `${project.id} / ${unit.name}`);
        const derived = deriveProjectUnitStatus(unit.startDate, unit.endDate, null, null);

        db.prepare(
          `
            INSERT OR IGNORE INTO project_units (
              id,
              workspace_id,
              project_id,
              code,
              name,
              sort_order,
              status,
              status_source,
              color_key,
              start_date,
              end_date,
              notes,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          unit.id,
          workspaceId,
          project.id,
          unit.code,
          unit.name,
          unit.sortOrder,
          derived.status,
          derived.statusSource,
          unit.colorKey,
          unit.startDate,
          unit.endDate,
          unit.notes,
          now,
          now,
        );

        unit.crewAssignments?.forEach((assignment) => {
          if (!crewIds.has(assignment.crewMemberId)) {
            return;
          }

          db.prepare(
            `
              INSERT OR IGNORE INTO project_unit_crew_assignments (
                id,
                workspace_id,
                project_unit_id,
                crew_member_id,
                role_label,
                start_date,
                end_date,
                notes,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            assignment.id,
            workspaceId,
            unit.id,
            assignment.crewMemberId,
            assignment.roleLabel,
            assignment.startDate,
            assignment.endDate,
            assignment.notes,
            now,
            now,
          );
        });
      });

      const primaryUnitId = resolvePrimaryUnitId(db, project.id);

      if (primaryUnitId) {
        db.prepare(
          `
            UPDATE asset_current_state
            SET project_unit_id = ?
            WHERE current_project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);

        db.prepare(
          `
            UPDATE asset_assignments
            SET project_unit_id = ?
            WHERE project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);

        db.prepare(
          `
            UPDATE packing_slips
            SET project_unit_id = ?
            WHERE project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);

        db.prepare(
          `
            UPDATE incidents
            SET project_unit_id = ?
            WHERE project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);

        db.prepare(
          `
            UPDATE financial_entries
            SET project_unit_id = ?
            WHERE project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);

        db.prepare(
          `
            UPDATE collaborator_fees
            SET project_unit_id = ?
            WHERE project_id = ?
              AND project_unit_id IS NULL
          `,
        ).run(primaryUnitId, project.id);
      }
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
