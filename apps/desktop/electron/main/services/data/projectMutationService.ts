import type { DatabaseSync } from "node:sqlite";

import type {
  AssignCrewToProjectUnitInput,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  UnassignCrewFromProjectUnitInput,
  UpdateProjectInput,
  UpdateProjectUnitInput,
} from "@contracts";

import {
  assertDateWindow,
  deriveProjectUnitStatus,
  normalizeDateOnly,
  todayDateOnly,
} from "./projectScheduling";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
const placeholderTimestamp = "2026-04-09T18:45:00.000Z";

const placeholderProjects = [
  {
    id: "project-archipielago",
    code: "ARCH",
    name: "Archipiélado",
    clientName: "Placeholder",
    status: "Prep",
    description: "Project shell placeholder for upcoming inventory and staffing flows.",
  },
  {
    id: "project-oar-netflix",
    code: "OAR",
    name: "Ana Guerrero / Netflix",
    clientName: "Netflix",
    status: "Prep",
    description: "Project shell placeholder for upcoming inventory and staffing flows.",
  },
  {
    id: "project-shiver",
    code: "SHIV",
    name: "Shiver",
    clientName: "Placeholder",
    status: "Prep",
    description: "Project shell placeholder for upcoming inventory and staffing flows.",
  },
  {
    id: "project-a-thousand-blows",
    code: "ATB",
    name: "A Thousand Blows",
    clientName: "Placeholder",
    status: "Prep",
    description: "Project shell placeholder for upcoming inventory and staffing flows.",
  },
] as const;

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const ensureValue = (value: string, label: string) => {
  const nextValue = value.trim();

  if (!nextValue) {
    throw new Error(`${label} is required.`);
  }

  return nextValue;
};

const normalizeColorKey = (value?: string | null) => {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
};

const resolveClientReference = (db: DatabaseSync, input: { clientId?: string; clientName?: string }) => {
  const directClientId = input.clientId?.trim();

  if (directClientId) {
    const existingClient = db
      .prepare("SELECT id, name FROM clients WHERE id = ? LIMIT 1")
      .get(directClientId) as { id: string; name: string } | undefined;

    if (!existingClient) {
      throw new Error("Selected client was not found.");
    }

    return existingClient;
  }

  const clientName = input.clientName?.trim();

  if (!clientName) {
    return null;
  }

  const existingClient = db
    .prepare(
      `
        SELECT id, name
        FROM clients
        WHERE workspace_id = ?
          AND lower(name) = lower(?)
        LIMIT 1
      `,
    )
    .get(workspaceId, clientName) as { id: string; name: string } | undefined;

  if (existingClient) {
    return existingClient;
  }

  const clientId = `client-${slugify(clientName)}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO clients (
        id,
        workspace_id,
        name,
        contact_name,
        email,
        phone,
        notes,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, NULL, NULL, NULL, 'Created from project flow.', 1, ?, ?)
    `,
  ).run(clientId, workspaceId, clientName, now, now);

  return {
    id: clientId,
    name: clientName,
  };
};

const assertCodeAvailability = (db: DatabaseSync, code: string, currentProjectId?: string) => {
  const existingProject = db
    .prepare(
      `
        SELECT id
        FROM projects
        WHERE workspace_id = ?
          AND code = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, code, currentProjectId ?? null, currentProjectId ?? null) as { id: string } | undefined;

  if (existingProject) {
    throw new Error(`Project code ${code} is already in use.`);
  }
};

const assertProjectUnitCodeAvailability = (db: DatabaseSync, projectId: string, code: string, currentUnitId?: string) => {
  const existingUnit = db
    .prepare(
      `
        SELECT id
        FROM project_units
        WHERE project_id = ?
          AND code = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(projectId, code, currentUnitId ?? null, currentUnitId ?? null) as { id: string } | undefined;

  if (existingUnit) {
    throw new Error(`Unit code ${code} is already in use inside this project.`);
  }
};

const getProjectRelationCount = (db: DatabaseSync, projectId: string) => {
  const relationCounts = db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM asset_current_state WHERE current_project_id = ?) AS current_asset_count,
          (SELECT COUNT(*) FROM asset_assignments WHERE project_id = ?) AS assignment_count,
          (SELECT COUNT(*) FROM incidents WHERE project_id = ?) AS incident_count,
          (SELECT COUNT(*) FROM packing_slips WHERE project_id = ?) AS packing_count,
          (SELECT COUNT(*) FROM financial_entries WHERE project_id = ?) AS finance_count,
          (SELECT COUNT(*) FROM collaborator_fees WHERE project_id = ?) AS collaborator_fee_count,
          (SELECT COUNT(*) FROM project_units WHERE project_id = ?) AS unit_count
      `,
    )
    .get(projectId, projectId, projectId, projectId, projectId, projectId, projectId) as {
    current_asset_count: number;
    assignment_count: number;
    incident_count: number;
    packing_count: number;
    finance_count: number;
    collaborator_fee_count: number;
    unit_count: number;
  };

  return (
    relationCounts.current_asset_count +
    relationCounts.assignment_count +
    relationCounts.incident_count +
    relationCounts.packing_count +
    relationCounts.finance_count +
    relationCounts.collaborator_fee_count +
    relationCounts.unit_count
  );
};

const getProjectUnitRelationCount = (db: DatabaseSync, unitId: string) => {
  const relationCounts = db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM asset_current_state WHERE project_unit_id = ?) AS current_asset_count,
          (SELECT COUNT(*) FROM asset_assignments WHERE project_unit_id = ?) AS assignment_count,
          (SELECT COUNT(*) FROM incidents WHERE project_unit_id = ?) AS incident_count,
          (SELECT COUNT(*) FROM packing_slips WHERE project_unit_id = ?) AS packing_count,
          (SELECT COUNT(*) FROM financial_entries WHERE project_unit_id = ?) AS finance_count,
          (SELECT COUNT(*) FROM collaborator_fees WHERE project_unit_id = ?) AS collaborator_fee_count
      `,
    )
    .get(unitId, unitId, unitId, unitId, unitId, unitId) as {
    current_asset_count: number;
    assignment_count: number;
    incident_count: number;
    packing_count: number;
    finance_count: number;
    collaborator_fee_count: number;
  };

  return (
    relationCounts.current_asset_count +
    relationCounts.assignment_count +
    relationCounts.incident_count +
    relationCounts.packing_count +
    relationCounts.finance_count +
    relationCounts.collaborator_fee_count
  );
};

const getProjectRow = (db: DatabaseSync, projectId: string) =>
  db
    .prepare(
      `
        SELECT id, start_date, end_date, color_key, description, status
        FROM projects
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(projectId) as
    | {
        id: string;
        start_date: string | null;
        end_date: string | null;
        color_key: string | null;
        description: string | null;
        status: string;
      }
    | undefined;

const getProjectUnitRow = (db: DatabaseSync, unitId: string, projectId: string) =>
  db
    .prepare(
      `
        SELECT
          id,
          project_id,
          code,
          name,
          sort_order,
          status,
          status_source,
          color_key,
          start_date,
          end_date,
          notes
        FROM project_units
        WHERE id = ?
          AND project_id = ?
        LIMIT 1
      `,
    )
    .get(unitId, projectId) as
    | {
        id: string;
        project_id: string;
        code: string;
        name: string;
        sort_order: number;
        status: string;
        status_source: "derived" | "manual_override";
        color_key: string | null;
        start_date: string | null;
        end_date: string | null;
        notes: string | null;
      }
    | undefined;

const ensureProjectExists = (db: DatabaseSync, projectId: string) => {
  const project = getProjectRow(db, projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  return project;
};

const ensureProjectUnitExists = (db: DatabaseSync, projectId: string, unitId: string) => {
  const unit = getProjectUnitRow(db, unitId, projectId);

  if (!unit) {
    throw new Error("Project unit not found.");
  }

  return unit;
};

const ensureCrewMemberExists = (db: DatabaseSync, crewMemberId: string) => {
  const crewMember = db
    .prepare(
      `
        SELECT id
        FROM crew_members
        WHERE id = ?
          AND workspace_id = ?
        LIMIT 1
      `,
    )
    .get(crewMemberId, workspaceId) as { id: string } | undefined;

  if (!crewMember) {
    throw new Error("Crew member not found.");
  }
};

const assertUnitWithinProjectWindow = (
  projectStartDate: string | null,
  projectEndDate: string | null,
  unitStartDate: string | null,
  unitEndDate: string | null,
) => {
  if (projectStartDate && unitStartDate && unitStartDate < projectStartDate) {
    throw new Error("Unit start date cannot be earlier than the project start date.");
  }

  if (projectEndDate && unitEndDate && unitEndDate > projectEndDate) {
    throw new Error("Unit end date cannot be later than the project end date.");
  }
};

const assertExistingUnitsWithinProjectWindow = (
  db: DatabaseSync,
  projectId: string,
  projectStartDate: string | null,
  projectEndDate: string | null,
) => {
  const conflictingUnits = db
    .prepare(
      `
        SELECT code, name, start_date, end_date
        FROM project_units
        WHERE project_id = ?
          AND (
            (? IS NOT NULL AND start_date IS NOT NULL AND start_date < ?)
            OR (? IS NOT NULL AND end_date IS NOT NULL AND end_date > ?)
          )
        ORDER BY sort_order, start_date, name
        LIMIT 1
      `,
    )
    .get(projectId, projectStartDate, projectStartDate, projectEndDate, projectEndDate) as
    | {
        code: string;
        name: string;
        start_date: string | null;
        end_date: string | null;
      }
    | undefined;

  if (conflictingUnits) {
    throw new Error(
      `${conflictingUnits.code} · ${conflictingUnits.name} falls outside the new project date window. Adjust the unit first.`,
    );
  }
};

const resolveDerivedStatusRow = (
  startDate: string | null,
  endDate: string | null,
  storedStatus: string | null,
  statusSource: string | null,
) => deriveProjectUnitStatus(startDate, endDate, storedStatus, statusSource);

export const ensureProjectShellDefaults = (db: DatabaseSync) => {
  const statement = db.prepare(
    `
      INSERT OR IGNORE INTO projects (
        id,
        workspace_id,
        code,
        name,
        client_name,
        status,
        start_date,
        end_date,
        description,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `,
  );

  for (const project of placeholderProjects) {
    statement.run(
      project.id,
      workspaceId,
      project.code,
      project.name,
      project.clientName,
      project.status,
      project.description,
      placeholderTimestamp,
      placeholderTimestamp,
    );
  }
};

export const createProjectMutationService = (db: DatabaseSync) => ({
  createProject(input: CreateProjectInput) {
    const code = ensureValue(input.code, "Project code").toUpperCase();
    const name = ensureValue(input.name, "Project name");
    const now = new Date().toISOString();
    const client = resolveClientReference(db, input);
    const startDate = normalizeDateOnly(input.startDate);
    const endDate = normalizeDateOnly(input.endDate);
    const colorKey = normalizeColorKey(input.colorKey);

    assertDateWindow(startDate, endDate, "Project");
    assertCodeAvailability(db, code);

    const projectId = `project-${slugify(code)}-${Date.now().toString(36)}`;

    db.prepare(
      `
        INSERT INTO projects (
          id,
          workspace_id,
          code,
          name,
          client_id,
          client_name,
          status,
          start_date,
          end_date,
          color_key,
          description,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      projectId,
      workspaceId,
      code,
      name,
      client?.id ?? null,
      client?.name ?? input.clientName?.trim() ?? null,
      input.status?.trim() || "Prep",
      startDate,
      endDate,
      colorKey,
      input.description?.trim() || "Project created from the sidebar shell.",
      now,
      now,
    );
  },

  updateProject(input: UpdateProjectInput) {
    const code = ensureValue(input.code, "Project code").toUpperCase();
    const name = ensureValue(input.name, "Project name");
    const now = new Date().toISOString();
    const client = resolveClientReference(db, input);
    const currentProject = ensureProjectExists(db, input.projectId);

    assertCodeAvailability(db, code, input.projectId);

    const startDate = input.startDate === undefined ? currentProject.start_date : normalizeDateOnly(input.startDate);
    const endDate = input.endDate === undefined ? currentProject.end_date : normalizeDateOnly(input.endDate);
    const colorKey = input.colorKey === undefined ? currentProject.color_key : normalizeColorKey(input.colorKey);

    assertDateWindow(startDate, endDate, "Project");
    assertExistingUnitsWithinProjectWindow(db, input.projectId, startDate, endDate);

    const result = db.prepare(
      `
        UPDATE projects
        SET
          code = ?,
          name = ?,
          client_id = ?,
          client_name = ?,
          status = ?,
          start_date = ?,
          end_date = ?,
          color_key = ?,
          description = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      code,
      name,
      client?.id ?? null,
      client?.name ?? input.clientName?.trim() ?? null,
      input.status?.trim() || currentProject.status || "Prep",
      startDate,
      endDate,
      colorKey,
      input.description?.trim() || null,
      now,
      input.projectId,
    );

    if (!result.changes) {
      throw new Error("Project not found.");
    }
  },

  deleteProject(input: DeleteProjectInput) {
    const relationCount = getProjectRelationCount(db, input.projectId);

    if (relationCount > 0) {
      throw new Error("This project already has linked operational records and cannot be deleted yet.");
    }

    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(input.projectId);

    if (!result.changes) {
      throw new Error("Project not found.");
    }
  },

  createProjectUnit(input: CreateProjectUnitInput) {
    const project = ensureProjectExists(db, input.projectId);
    const code = ensureValue(input.code, "Unit code").toUpperCase();
    const name = ensureValue(input.name, "Unit name");
    const startDate = normalizeDateOnly(input.startDate);
    const endDate = normalizeDateOnly(input.endDate);
    const colorKey = normalizeColorKey(input.colorKey);
    const now = new Date().toISOString();
    const currentSortOrder =
      typeof input.sortOrder === "number"
        ? input.sortOrder
        : ((db
            .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order FROM project_units WHERE project_id = ?")
            .get(input.projectId) as { max_sort_order: number }).max_sort_order ?? 0) + 1;

    assertProjectUnitCodeAvailability(db, input.projectId, code);
    assertDateWindow(startDate, endDate, "Project unit");
    assertUnitWithinProjectWindow(project.start_date, project.end_date, startDate, endDate);

    const derived = resolveDerivedStatusRow(startDate, endDate, null, null);

    db.prepare(
      `
        INSERT INTO project_units (
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
      `unit-${slugify(input.projectId)}-${slugify(code)}-${Date.now().toString(36)}`,
      workspaceId,
      input.projectId,
      code,
      name,
      currentSortOrder,
      derived.status,
      derived.statusSource,
      colorKey,
      startDate,
      endDate,
      input.notes?.trim() || null,
      now,
      now,
    );
  },

  updateProjectUnit(input: UpdateProjectUnitInput) {
    const project = ensureProjectExists(db, input.projectId);
    const currentUnit = ensureProjectUnitExists(db, input.projectId, input.unitId);
    const code = ensureValue(input.code, "Unit code").toUpperCase();
    const name = ensureValue(input.name, "Unit name");
    const now = new Date().toISOString();

    assertProjectUnitCodeAvailability(db, input.projectId, code, input.unitId);

    let startDate = normalizeDateOnly(input.startDate);
    let endDate = normalizeDateOnly(input.endDate);
    const colorKey = normalizeColorKey(input.colorKey);
    let nextStoredStatus = currentUnit.status;
    let nextStoredStatusSource = currentUnit.status_source;

    assertDateWindow(startDate, endDate, "Project unit");
    assertUnitWithinProjectWindow(project.start_date, project.end_date, startDate, endDate);

    if (input.statusAction === "cancel") {
      nextStoredStatus = "cancelled";
      nextStoredStatusSource = "manual_override";
    } else if (input.statusAction === "reactivate") {
      const derived = resolveDerivedStatusRow(startDate, endDate, null, null);
      nextStoredStatus = derived.status;
      nextStoredStatusSource = derived.statusSource;
    } else if (input.statusAction === "mark_wrapped") {
      endDate = todayDateOnly();
      assertDateWindow(startDate, endDate, "Project unit");
      const derived = resolveDerivedStatusRow(startDate, endDate, null, null);
      nextStoredStatus = derived.status;
      nextStoredStatusSource = derived.statusSource;
    } else {
      const derived = resolveDerivedStatusRow(startDate, endDate, currentUnit.status, currentUnit.status_source);
      nextStoredStatus = derived.status;
      nextStoredStatusSource = derived.statusSource;
    }

    db.prepare(
      `
        UPDATE project_units
        SET
          code = ?,
          name = ?,
          sort_order = ?,
          status = ?,
          status_source = ?,
          color_key = ?,
          start_date = ?,
          end_date = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
          AND project_id = ?
      `,
    ).run(
      code,
      name,
      input.sortOrder,
      nextStoredStatus,
      nextStoredStatusSource,
      colorKey,
      startDate,
      endDate,
      input.notes?.trim() || null,
      now,
      input.unitId,
      input.projectId,
    );
  },

  deleteProjectUnit(input: DeleteProjectUnitInput) {
    ensureProjectUnitExists(db, input.projectId, input.unitId);
    const relationCount = getProjectUnitRelationCount(db, input.unitId);

    if (relationCount > 0) {
      throw new Error("This unit already has linked operational records and cannot be deleted yet.");
    }

    db.exec("BEGIN");

    try {
      db.prepare("DELETE FROM project_unit_crew_assignments WHERE project_unit_id = ?").run(input.unitId);
      const result = db.prepare("DELETE FROM project_units WHERE id = ? AND project_id = ?").run(input.unitId, input.projectId);

      if (!result.changes) {
        throw new Error("Project unit not found.");
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  assignCrewToProjectUnit(input: AssignCrewToProjectUnitInput) {
    const unit = ensureProjectUnitExists(db, input.projectId, input.unitId);
    ensureCrewMemberExists(db, input.crewMemberId);
    const startDate = normalizeDateOnly(input.startDate);
    const endDate = normalizeDateOnly(input.endDate);
    const now = new Date().toISOString();

    assertDateWindow(startDate, endDate, "Crew assignment");
    assertUnitWithinProjectWindow(unit.start_date, unit.end_date, startDate, endDate);

    const existingAssignment = db
      .prepare(
        `
          SELECT id
          FROM project_unit_crew_assignments
          WHERE project_unit_id = ?
            AND crew_member_id = ?
          LIMIT 1
        `,
      )
      .get(input.unitId, input.crewMemberId) as { id: string } | undefined;

    if (existingAssignment) {
      throw new Error("This crew member is already linked to the selected unit.");
    }

    db.prepare(
      `
        INSERT INTO project_unit_crew_assignments (
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
      `unit-crew-${Date.now().toString(36)}`,
      workspaceId,
      input.unitId,
      input.crewMemberId,
      input.roleLabel?.trim() || null,
      startDate,
      endDate,
      input.notes?.trim() || null,
      now,
      now,
    );
  },

  unassignCrewFromProjectUnit(input: UnassignCrewFromProjectUnitInput) {
    ensureProjectUnitExists(db, input.projectId, input.unitId);
    const result = db
      .prepare(
        `
          DELETE FROM project_unit_crew_assignments
          WHERE id = ?
            AND project_unit_id = ?
        `,
      )
      .run(input.assignmentId, input.unitId);

    if (!result.changes) {
      throw new Error("Crew assignment not found.");
    }
  },
});
