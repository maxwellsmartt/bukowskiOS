import type { DatabaseSync } from "node:sqlite";

import type {
  AssignCrewToProjectUnitInput,
  CreateProjectBlueprintInput,
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

const normalizeOptionalText = (value?: string | null) => {
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

const resolveProductionCompanyReference = (
  db: DatabaseSync,
  input: { productionCompanyId?: string; productionCompanyName?: string },
) => {
  const directId = input.productionCompanyId?.trim();

  if (directId) {
    const existing = db
      .prepare("SELECT id, name FROM production_companies WHERE id = ? LIMIT 1")
      .get(directId) as { id: string; name: string } | undefined;

    if (!existing) {
      throw new Error("Selected production company was not found.");
    }

    return existing;
  }

  const companyName = input.productionCompanyName?.trim();

  if (!companyName) {
    return null;
  }

  const existing = db
    .prepare(
      `
        SELECT id, name
        FROM production_companies
        WHERE workspace_id = ?
          AND lower(name) = lower(?)
        LIMIT 1
      `,
    )
    .get(workspaceId, companyName) as { id: string; name: string } | undefined;

  if (existing) {
    return existing;
  }

  const productionCompanyId = `production-company-${slugify(companyName)}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO production_companies (
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
      VALUES (?, ?, ?, NULL, NULL, NULL, 'Created from project setup.', 1, ?, ?)
    `,
  ).run(productionCompanyId, workspaceId, companyName, now, now);

  return {
    id: productionCompanyId,
    name: companyName,
  };
};

const assertPreproductionWindow = (
  hasPreproduction: boolean,
  preproductionStartDate: string | null,
  preproductionEndDate: string | null,
  projectStartDate: string | null,
) => {
  if (!hasPreproduction) {
    if (preproductionStartDate || preproductionEndDate) {
      throw new Error("Pre-production dates require the pre-production toggle to be enabled.");
    }

    return;
  }

  assertDateWindow(preproductionStartDate, preproductionEndDate, "Pre-production");

  if (!preproductionStartDate || !preproductionEndDate) {
    throw new Error("Pre-production start and end dates are required when pre-production is enabled.");
  }

  if (projectStartDate && preproductionEndDate > projectStartDate) {
    throw new Error("Pre-production must end on or before the project start date.");
  }
};

const ensureUserExists = (db: DatabaseSync, userId: string | undefined, label: string) => {
  if (!userId) {
    return;
  }

  const row = db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(userId) as { id: string } | undefined;

  if (!row) {
    throw new Error(`${label} was not found.`);
  }
};

const ensureDepartmentExists = (db: DatabaseSync, departmentId: string | undefined, label: string) => {
  if (!departmentId) {
    return;
  }

  const row = db.prepare("SELECT id FROM departments WHERE id = ? LIMIT 1").get(departmentId) as { id: string } | undefined;

  if (!row) {
    throw new Error(`${label} was not found.`);
  }
};

const ensureAssetIdsExist = (db: DatabaseSync, assetIds: string[]) => {
  if (!assetIds.length) {
    return;
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT id FROM assets WHERE id IN (${placeholders}) AND workspace_id = ?`)
    .all(...assetIds, workspaceId) as Array<{ id: string }>;

  if (rows.length !== assetIds.length) {
    throw new Error("One or more selected assets are no longer available.");
  }
};

const uniqueValues = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const parsePackingSequence = (value: string) => {
  const match = value.match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
};

const getNextPackingSequence = (db: DatabaseSync) => {
  const rows = db.prepare("SELECT id FROM packing_slips").all() as Array<{ id: string }>;
  const currentMax = rows.reduce((highest, row) => Math.max(highest, parsePackingSequence(row.id)), 0);
  return currentMax + 1;
};

const buildPackingIdentifiers = (sequence: number) => {
  const serial = String(sequence).padStart(4, "0");

  return {
    packingSlipId: `packing-${serial}`,
    slipNumber: `PS-${serial}`,
  };
};

const resolveDateOverlap = (
  leftStartDate: string | null,
  leftEndDate: string | null,
  rightStartDate: string | null,
  rightEndDate: string | null,
) => {
  if (!leftStartDate || !leftEndDate || !rightStartDate || !rightEndDate) {
    return false;
  }

  return leftStartDate <= rightEndDate && rightStartDate <= leftEndDate;
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
             , production_company_id, production_company_name, has_preproduction, preproduction_start_date, preproduction_end_date
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
        production_company_id: string | null;
        production_company_name: string | null;
        has_preproduction: number;
        preproduction_start_date: string | null;
        preproduction_end_date: string | null;
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
    const productionCompany = resolveProductionCompanyReference(db, input);
    const startDate = normalizeDateOnly(input.startDate);
    const endDate = normalizeDateOnly(input.endDate);
    const hasPreproduction = Boolean(input.hasPreproduction);
    const preproductionStartDate = normalizeDateOnly(input.preproductionStartDate);
    const preproductionEndDate = normalizeDateOnly(input.preproductionEndDate);
    const colorKey = normalizeColorKey(input.colorKey);

    assertDateWindow(startDate, endDate, "Project");
    assertPreproductionWindow(hasPreproduction, preproductionStartDate, preproductionEndDate, startDate);
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
          production_company_id,
          production_company_name,
          status,
          start_date,
          end_date,
          has_preproduction,
          preproduction_start_date,
          preproduction_end_date,
          color_key,
          description,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      projectId,
      workspaceId,
      code,
      name,
      client?.id ?? null,
      client?.name ?? input.clientName?.trim() ?? null,
      productionCompany?.id ?? null,
      productionCompany?.name ?? input.productionCompanyName?.trim() ?? null,
      input.status?.trim() || "Prep",
      startDate,
      endDate,
      hasPreproduction ? 1 : 0,
      preproductionStartDate,
      preproductionEndDate,
      colorKey,
      input.description?.trim() || "Project created from the sidebar shell.",
      now,
      now,
    );
  },

  createProjectBlueprint(input: CreateProjectBlueprintInput) {
    const now = new Date().toISOString();
    const code = ensureValue(input.generalInfo.code, "Project code").toUpperCase();
    const name = ensureValue(input.generalInfo.name, "Project name");
    const client = resolveClientReference(db, input.generalInfo);
    const productionCompany = resolveProductionCompanyReference(db, input.generalInfo);
    const startDate = normalizeDateOnly(input.generalInfo.startDate);
    const endDate = normalizeDateOnly(input.generalInfo.endDate);
    const hasPreproduction = Boolean(input.generalInfo.hasPreproduction);
    const preproductionStartDate = normalizeDateOnly(input.generalInfo.preproductionStartDate);
    const preproductionEndDate = normalizeDateOnly(input.generalInfo.preproductionEndDate);
    const colorKey = normalizeColorKey(input.generalInfo.colorKey);
    const mainUnitStartDate = startDate;
    const mainUnitEndDate = endDate;
    const mainUnitAssetIds = uniqueValues(input.mainUnit.assetIds);
    const draftSlipAssetIds =
      input.packingSelection.mode === "existing"
        ? (() => {
            const rows = db
              .prepare("SELECT asset_id FROM packing_slip_items WHERE packing_slip_id = ? ORDER BY asset_id")
              .all(input.packingSelection.packingSlipId) as Array<{ asset_id: string }>;
            return rows.map((row) => row.asset_id);
          })()
        : [];
    const combinedMainUnitAssetIds = uniqueValues(
      (input.packingSelection.mode === "existing" ? draftSlipAssetIds : []).concat(mainUnitAssetIds),
    );
    const projectId = `project-${slugify(code)}-${Date.now().toString(36)}`;
    const mainUnitId = `unit-${slugify(projectId)}-main`;
    const defaultActorUserId = "user-ops";
    const defaultCommandId = `project-setup-${Date.now().toString(36)}`;

    assertDateWindow(startDate, endDate, "Project");
    assertPreproductionWindow(hasPreproduction, preproductionStartDate, preproductionEndDate, startDate);
    assertCodeAvailability(db, code);
    ensureAssetIdsExist(db, combinedMainUnitAssetIds);

    const normalizedAdditionalUnits = input.additionalUnits.map((unit, index) => {
      const unitStartDate = normalizeDateOnly(unit.startDate);
      const unitEndDate = normalizeDateOnly(unit.endDate);
      const resolvedCode = ensureValue(unit.code?.trim() || `${code}-${index + 2}U`, "Unit code").toUpperCase();

      assertDateWindow(unitStartDate, unitEndDate, "Project unit");
      assertUnitWithinProjectWindow(startDate, endDate, unitStartDate, unitEndDate);

      ensureAssetIdsExist(db, uniqueValues(unit.assetIds));
      assertProjectUnitCodeAvailability(db, projectId, resolvedCode);

      return {
        ...unit,
        assetIds: uniqueValues(unit.assetIds),
        code: resolvedCode,
        id: unit.id?.trim() || `unit-${slugify(projectId)}-${slugify(resolvedCode)}-${Date.now().toString(36)}-${index}`,
        sortOrder: unit.sortOrder ?? index + 1,
        startDate: unitStartDate,
        endDate: unitEndDate,
      };
    });

    const crewAssignmentDrafts = [
      ...input.mainUnit.crewAssignments.map((assignment) => ({
        ...assignment,
        unitId: mainUnitId,
        unitName: "Main Unit",
        unitStartDate: mainUnitStartDate,
        unitEndDate: mainUnitEndDate,
      })),
      ...normalizedAdditionalUnits.flatMap((unit) =>
        unit.crewAssignments.map((assignment) => ({
          ...assignment,
          unitId: unit.id!,
          unitName: unit.name,
          unitStartDate: unit.startDate ?? null,
          unitEndDate: unit.endDate ?? null,
        })),
      ),
    ];

    crewAssignmentDrafts.forEach((assignment) => {
      ensureCrewMemberExists(db, assignment.crewMemberId);
      const assignmentStartDate = normalizeDateOnly(assignment.startDate);
      const assignmentEndDate = normalizeDateOnly(assignment.endDate);
      assertDateWindow(assignmentStartDate, assignmentEndDate, "Crew assignment");
      assertUnitWithinProjectWindow(
        assignment.unitStartDate,
        assignment.unitEndDate,
        assignmentStartDate,
        assignmentEndDate,
      );
    });

    const conflictingProjectsByAsset = combinedMainUnitAssetIds.concat(...normalizedAdditionalUnits.flatMap((unit) => unit.assetIds));
    if (conflictingProjectsByAsset.length) {
      const placeholders = conflictingProjectsByAsset.map(() => "?").join(", ");
      const assetRows = db
        .prepare(
          `
            SELECT
              asset_current_state.asset_id,
              assets.name AS asset_name,
              projects.name AS project_name,
              projects.status AS project_status,
              project_units.status AS unit_status,
              COALESCE(project_units.start_date, projects.start_date) AS start_date,
              COALESCE(project_units.end_date, projects.end_date) AS end_date
            FROM asset_current_state
            JOIN assets ON assets.id = asset_current_state.asset_id
            LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
            LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
            WHERE asset_current_state.asset_id IN (${placeholders})
              AND asset_current_state.current_project_id IS NOT NULL
          `,
        )
        .all(...conflictingProjectsByAsset) as Array<{
        asset_id: string;
        asset_name: string;
        project_name: string | null;
        project_status: string | null;
        unit_status: string | null;
        start_date: string | null;
        end_date: string | null;
      }>;

      const allUnitWindows = [
        { name: "Main Unit", assetIds: combinedMainUnitAssetIds, startDate: mainUnitStartDate, endDate: mainUnitEndDate },
        ...normalizedAdditionalUnits.map((unit) => ({
          name: unit.name,
          assetIds: unit.assetIds,
          startDate: unit.startDate ?? null,
          endDate: unit.endDate ?? null,
        })),
      ];

      const conflictingAsset = assetRows.find((row) => {
        if (!row.project_status || !row.project_name || row.project_status === "Wrapped" || row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return false;
        }

        return allUnitWindows.some((unit) => unit.assetIds.includes(row.asset_id) && resolveDateOverlap(unit.startDate, unit.endDate, row.start_date, row.end_date));
      });

      if (conflictingAsset) {
        throw new Error(`${conflictingAsset.asset_name} overlaps with ${conflictingAsset.project_name}. Resolve that asset conflict first.`);
      }
    }

    if (crewAssignmentDrafts.length) {
      const placeholders = crewAssignmentDrafts.map(() => "?").join(", ");
      const crewRows = db
        .prepare(
          `
            SELECT
              project_unit_crew_assignments.crew_member_id,
              COALESCE(crew_members.full_name, 'Crew member') AS crew_name,
              projects.name AS project_name,
              projects.status AS project_status,
              project_units.name AS unit_name,
              project_units.status AS unit_status,
              COALESCE(project_unit_crew_assignments.start_date, project_units.start_date, projects.start_date) AS start_date,
              COALESCE(project_unit_crew_assignments.end_date, project_units.end_date, projects.end_date) AS end_date
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            JOIN projects ON projects.id = project_units.project_id
            LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
            WHERE project_unit_crew_assignments.crew_member_id IN (${placeholders})
          `,
        )
        .all(...crewAssignmentDrafts.map((assignment) => assignment.crewMemberId)) as Array<{
        crew_member_id: string;
        crew_name: string;
        project_name: string;
        project_status: string;
        unit_name: string;
        unit_status: string;
        start_date: string | null;
        end_date: string | null;
      }>;

      const conflictingCrew = crewRows.find((row) => {
        if (row.project_status === "Wrapped" || row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return false;
        }

        return crewAssignmentDrafts.some((assignment) => {
          const assignmentStartDate = normalizeDateOnly(assignment.startDate);
          const assignmentEndDate = normalizeDateOnly(assignment.endDate);
          const fallbackStartDate = assignment.unitStartDate;
          const fallbackEndDate = assignment.unitEndDate;
          return (
            assignment.crewMemberId === row.crew_member_id &&
            resolveDateOverlap(
              assignmentStartDate ?? fallbackStartDate,
              assignmentEndDate ?? fallbackEndDate,
              row.start_date,
              row.end_date,
            )
          );
        });
      });

      if (conflictingCrew) {
        throw new Error(`${conflictingCrew.crew_name} overlaps with ${conflictingCrew.project_name} / ${conflictingCrew.unit_name}. Resolve that crew conflict first.`);
      }
    }

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO projects (
            id,
            workspace_id,
            code,
            name,
            client_id,
            client_name,
            production_company_id,
            production_company_name,
            status,
            start_date,
            end_date,
            has_preproduction,
            preproduction_start_date,
            preproduction_end_date,
            color_key,
            description,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        projectId,
        workspaceId,
        code,
        name,
        client?.id ?? null,
        client?.name ?? normalizeOptionalText(input.generalInfo.clientName),
        productionCompany?.id ?? null,
        productionCompany?.name ?? normalizeOptionalText(input.generalInfo.productionCompanyName),
        normalizeOptionalText(input.generalInfo.status) ?? "Prep",
        startDate,
        endDate,
        hasPreproduction ? 1 : 0,
        preproductionStartDate,
        preproductionEndDate,
        colorKey,
        normalizeOptionalText(input.generalInfo.description) ?? "Project created from setup wizard.",
        now,
        now,
      );

      const insertUnit = db.prepare(
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
            is_primary,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      const mainDerived = resolveDerivedStatusRow(mainUnitStartDate, mainUnitEndDate, null, null);
      insertUnit.run(
        mainUnitId,
        workspaceId,
        projectId,
        "MAIN",
        "Main Unit",
        0,
        mainDerived.status,
        mainDerived.statusSource,
        colorKey,
        mainUnitStartDate,
        mainUnitEndDate,
        normalizeOptionalText(input.mainUnit.notes),
        1,
        now,
        now,
      );

      normalizedAdditionalUnits.forEach((unit) => {
        const derived = resolveDerivedStatusRow(unit.startDate ?? null, unit.endDate ?? null, null, null);
        insertUnit.run(
          unit.id,
          workspaceId,
          projectId,
          unit.code,
          ensureValue(unit.name, "Unit name"),
          unit.sortOrder,
          derived.status,
          derived.statusSource,
          normalizeColorKey(unit.colorKey),
          unit.startDate ?? null,
          unit.endDate ?? null,
          normalizeOptionalText(unit.notes),
          0,
          now,
          now,
        );
      });

      const insertCrewAssignment = db.prepare(
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
      );

      crewAssignmentDrafts.forEach((assignment, index) => {
        insertCrewAssignment.run(
          `unit-crew-${Date.now().toString(36)}-${index}`,
          workspaceId,
          assignment.unitId,
          assignment.crewMemberId,
          normalizeOptionalText(assignment.roleLabel),
          normalizeDateOnly(assignment.startDate) ?? assignment.unitStartDate,
          normalizeDateOnly(assignment.endDate) ?? assignment.unitEndDate,
          normalizeOptionalText(assignment.notes),
          now,
          now,
        );
      });

      const assetRows = db
        .prepare(
          `
            SELECT
              asset_current_state.asset_id,
              asset_current_state.current_location_id,
              asset_current_state.current_department_id,
              asset_current_state.current_responsible_user_id,
              asset_current_state.active_assignment_id,
              asset_current_state.condition_status,
              asset_current_state.operational_status,
              asset_current_state.custody_status
            FROM asset_current_state
            WHERE asset_current_state.asset_id IN (${uniqueValues(combinedMainUnitAssetIds.concat(...normalizedAdditionalUnits.flatMap((unit) => unit.assetIds))).map(() => "?").join(", ")})
          `,
        )
        .all(...uniqueValues(combinedMainUnitAssetIds.concat(...normalizedAdditionalUnits.flatMap((unit) => unit.assetIds)))) as Array<{
        asset_id: string;
        current_location_id: string | null;
        current_department_id: string | null;
        current_responsible_user_id: string | null;
        active_assignment_id: string | null;
        condition_status: string;
        operational_status: string;
        custody_status: string;
      }>;
      const assetRowMap = new Map(assetRows.map((row) => [row.asset_id, row] as const));
      const closeAssignment = db.prepare("UPDATE asset_assignments SET assignment_status = 'reassigned', updated_at = ? WHERE id = ?");
      const insertAssignment = db.prepare(
        `
          INSERT INTO asset_assignments (
            id,
            workspace_id,
            asset_id,
            project_id,
            department_id,
            project_unit_id,
            assigned_to_user_id,
            assigned_by_user_id,
            source_location_id,
            target_location_id,
            assignment_status,
            checked_out_at,
            expected_return_at,
            returned_at,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
        `,
      );
      const insertEvent = db.prepare(
        `
          INSERT INTO asset_events (
            id,
            workspace_id,
            asset_id,
            assignment_id,
            project_id,
            department_id,
            performed_by_user_id,
            event_type,
            location_id,
            from_location_id,
            to_location_id,
            event_timestamp,
            command_id,
            actor_type,
            source_channel,
            notes,
            metadata_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      const updateAssetState = db.prepare(
        `
          UPDATE asset_current_state
          SET
            current_project_id = ?,
            project_unit_id = ?,
            active_assignment_id = ?,
            last_event_id = ?,
            custody_status = 'assigned',
            updated_at = ?,
            version = version + 1
          WHERE asset_id = ?
        `,
      );

      const unitsForAssets = [
        { id: mainUnitId, assetIds: combinedMainUnitAssetIds, endDate: mainUnitEndDate },
        ...normalizedAdditionalUnits.map((unit) => ({ id: unit.id!, assetIds: unit.assetIds, endDate: unit.endDate ?? endDate })),
      ];

      unitsForAssets.forEach((unit, unitIndex) => {
        unit.assetIds.forEach((assetId, assetIndex) => {
          const assetRow = assetRowMap.get(assetId);

          if (!assetRow) {
            throw new Error("One or more selected assets are no longer available.");
          }

          if (assetRow.custody_status === "checked_out") {
            throw new Error(`Asset ${assetId} is currently checked out and cannot be used in this project setup.`);
          }

          if (assetRow.active_assignment_id) {
            closeAssignment.run(now, assetRow.active_assignment_id);
          }

          const assignmentId = `assignment-${slugify(assetId)}-${Date.now().toString(36)}-${unitIndex}-${assetIndex}`;
          const eventId = `asset-event-${slugify(assetId)}-${Date.now().toString(36)}-${unitIndex}-${assetIndex}`;

          insertAssignment.run(
            assignmentId,
            workspaceId,
            assetId,
            projectId,
            assetRow.current_department_id,
            unit.id,
            assetRow.current_responsible_user_id,
            defaultActorUserId,
            assetRow.current_location_id,
            assetRow.current_location_id,
            "assigned",
            unit.endDate,
            "Assigned during project setup wizard.",
            now,
            now,
          );

          insertEvent.run(
            eventId,
            workspaceId,
            assetId,
            assignmentId,
            projectId,
            assetRow.current_department_id,
            defaultActorUserId,
            "assigned",
            assetRow.current_location_id,
            assetRow.current_location_id,
            assetRow.current_location_id,
            now,
            defaultCommandId,
            "system",
            "desktop",
            "Assigned during project setup wizard.",
            null,
            now,
          );

          updateAssetState.run(projectId, unit.id, assignmentId, eventId, now, assetId);
        });
      });

      const syncPackingSlipItems = (packingSlipId: string, assetIds: string[]) => {
        db.prepare("DELETE FROM packing_slip_items WHERE packing_slip_id = ?").run(packingSlipId);
        const insertPackingItem = db.prepare(
          `
            INSERT INTO packing_slip_items (
              id,
              packing_slip_id,
              asset_id,
              quantity,
              condition_out,
              condition_in,
              returned_at,
              notes
            )
            VALUES (?, ?, ?, 1, 'Good', NULL, NULL, NULL)
          `,
        );

        assetIds.forEach((assetId, index) => {
          insertPackingItem.run(`packing-item-${Date.now().toString(36)}-${index}`, packingSlipId, assetId);
        });
      };

      if (input.packingSelection.mode === "existing") {
        const existingSlip = db
          .prepare(
            `
              SELECT id
              FROM packing_slips
              WHERE id = ?
                AND COALESCE(lifecycle_state, 'operational') = 'staging'
              LIMIT 1
            `,
          )
          .get(input.packingSelection.packingSlipId) as { id: string } | undefined;

        if (!existingSlip) {
          throw new Error("Selected staging packing slip was not found.");
        }

        db.prepare(
          `
            UPDATE packing_slips
            SET
              project_id = ?,
              project_unit_id = ?,
              lifecycle_state = 'operational',
              status = 'Issued',
              issue_date = ?,
              updated_at = ?
            WHERE id = ?
          `,
        ).run(projectId, mainUnitId, todayDateOnly(), now, existingSlip.id);

        syncPackingSlipItems(existingSlip.id, combinedMainUnitAssetIds);
      } else if (input.packingSelection.mode === "draft" && combinedMainUnitAssetIds.length > 0) {
        ensureDepartmentExists(db, input.packingSelection.departmentId, "Selected department");
        ensureUserExists(db, input.packingSelection.responsibleUserId, "Selected responsible user");
        const nextPackingIdentifiers = buildPackingIdentifiers(getNextPackingSequence(db));

        db.prepare(
          `
            INSERT INTO packing_slips (
              id,
              workspace_id,
              project_id,
              project_unit_id,
              department_id,
              prepared_by_user_id,
              approved_by_user_id,
              responsible_user_id,
              lifecycle_state,
              status,
              issue_date,
              return_due_date,
              notes,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'operational', 'Issued', ?, ?, ?, ?, ?)
          `,
        ).run(
          nextPackingIdentifiers.packingSlipId,
          workspaceId,
          projectId,
          mainUnitId,
          input.packingSelection.departmentId?.trim() || null,
          defaultActorUserId,
          input.packingSelection.responsibleUserId?.trim() || null,
          todayDateOnly(),
          endDate,
          normalizeOptionalText(input.packingSelection.notes) ?? "Created during project setup wizard.",
          now,
          now,
        );

        syncPackingSlipItems(nextPackingIdentifiers.packingSlipId, combinedMainUnitAssetIds);
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  updateProject(input: UpdateProjectInput) {
    const code = ensureValue(input.code, "Project code").toUpperCase();
    const name = ensureValue(input.name, "Project name");
    const now = new Date().toISOString();
    const client = resolveClientReference(db, input);
    const productionCompany = resolveProductionCompanyReference(db, input);
    const currentProject = ensureProjectExists(db, input.projectId);

    assertCodeAvailability(db, code, input.projectId);

    const startDate = input.startDate === undefined ? currentProject.start_date : normalizeDateOnly(input.startDate);
    const endDate = input.endDate === undefined ? currentProject.end_date : normalizeDateOnly(input.endDate);
    const hasPreproduction =
      input.hasPreproduction === undefined ? Boolean(currentProject.has_preproduction) : Boolean(input.hasPreproduction);
    const preproductionStartDate =
      input.preproductionStartDate === undefined
        ? currentProject.preproduction_start_date
        : normalizeDateOnly(input.preproductionStartDate);
    const preproductionEndDate =
      input.preproductionEndDate === undefined
        ? currentProject.preproduction_end_date
        : normalizeDateOnly(input.preproductionEndDate);
    const colorKey = input.colorKey === undefined ? currentProject.color_key : normalizeColorKey(input.colorKey);

    assertDateWindow(startDate, endDate, "Project");
    assertPreproductionWindow(hasPreproduction, preproductionStartDate, preproductionEndDate, startDate);
    assertExistingUnitsWithinProjectWindow(db, input.projectId, startDate, endDate);

    const result = db.prepare(
      `
        UPDATE projects
        SET
          code = ?,
          name = ?,
          client_id = ?,
          client_name = ?,
          production_company_id = ?,
          production_company_name = ?,
          status = ?,
          start_date = ?,
          end_date = ?,
          has_preproduction = ?,
          preproduction_start_date = ?,
          preproduction_end_date = ?,
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
      productionCompany?.id ?? null,
      productionCompany?.name ?? input.productionCompanyName?.trim() ?? null,
      input.status?.trim() || currentProject.status || "Prep",
      startDate,
      endDate,
      hasPreproduction ? 1 : 0,
      preproductionStartDate,
      preproductionEndDate,
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
