import type { DatabaseSync } from "node:sqlite";

import type { CreateProjectInput, DeleteProjectInput, UpdateProjectInput } from "@contracts";

const workspaceId = "workspace-metadata";
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
          (SELECT COUNT(*) FROM collaborator_fees WHERE project_id = ?) AS collaborator_fee_count
      `,
    )
    .get(projectId, projectId, projectId, projectId, projectId, projectId) as {
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
          description,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `,
    ).run(
      projectId,
      workspaceId,
      code,
      name,
      client?.id ?? null,
      client?.name ?? input.clientName?.trim() ?? null,
      input.status?.trim() || "Prep",
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

    assertCodeAvailability(db, code, input.projectId);

    const result = db.prepare(
      `
        UPDATE projects
        SET
          code = ?,
          name = ?,
          client_id = ?,
          client_name = ?,
          status = ?,
          description = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      code,
      name,
      client?.id ?? null,
      client?.name ?? input.clientName?.trim() ?? null,
      input.status?.trim() || "Prep",
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
});
