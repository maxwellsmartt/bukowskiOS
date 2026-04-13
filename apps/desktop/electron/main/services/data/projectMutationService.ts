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

const normalizeCodeToken = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase();

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

type NormalizedUnitWindow = {
  id: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  label: string | null;
};

type NormalizedUnitDepartment = {
  departmentId: string;
  assetIds: string[];
  crewAssignments: Array<{
    crewMemberId: string;
    roleLabel: string | null;
    startDate: string | null;
    endDate: string | null;
    notes: string | null;
  }>;
  packingSeed:
    | {
        mode: "none";
      }
    | {
        mode: "existing";
        packingSlipId: string;
      }
    | {
        mode: "draft";
        label: string | null;
        responsibleUserId: string | null;
        notes: string | null;
      };
};

const deriveUnitBoundsFromWindows = (windows: NormalizedUnitWindow[]) => {
  const datedWindows = windows.filter((window) => window.startDate && window.endDate);

  if (!datedWindows.length) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  return {
    startDate: datedWindows.reduce((current, window) => (current && current < window.startDate! ? current : window.startDate), datedWindows[0]!.startDate),
    endDate: datedWindows.reduce((current, window) => (current && current > window.endDate! ? current : window.endDate), datedWindows[0]!.endDate),
  };
};

const normalizeUnitWindows = (
  windows: Array<{ id?: string; startDate?: string; endDate?: string; sortOrder?: number; label?: string }> | undefined,
  label: string,
) => {
  const normalized = (windows ?? []).map((window, index) => {
    const startDate = normalizeDateOnly(window.startDate);
    const endDate = normalizeDateOnly(window.endDate);
    assertDateWindow(startDate, endDate, `${label} window`);

    return {
      id: window.id?.trim() || `unit-window-${Date.now().toString(36)}-${index}`,
      startDate,
      endDate,
      sortOrder: window.sortOrder ?? index,
      label: normalizeOptionalText(window.label),
    } satisfies NormalizedUnitWindow;
  });

  return normalized.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return (left.startDate ?? "").localeCompare(right.startDate ?? "");
  });
};

const normalizeDepartmentIds = (departmentIds: string[] | undefined) => uniqueValues(departmentIds ?? []);

const ensureDepartmentIdsExist = (db: DatabaseSync, departmentIds: string[], label: string) => {
  departmentIds.forEach((departmentId) => ensureDepartmentExists(db, departmentId, label));
};

const normalizeUnitDepartments = (
  db: DatabaseSync,
  unit: CreateProjectBlueprintInput["mainUnit"],
  projectDepartmentIds: string[],
  label: string,
) => {
  const normalizedDepartments = (unit.unitDepartments ?? []).map((bucket) => {
    const departmentId = ensureValue(bucket.departmentId, `${label} department`);

    if (!projectDepartmentIds.includes(departmentId)) {
      throw new Error(`${label} uses a department outside the project pool.`);
    }

    ensureDepartmentExists(db, departmentId, `${label} department`);
    ensureAssetIdsExist(db, uniqueValues(bucket.assetIds));

    const normalizedCrewAssignments = (bucket.crewAssignments ?? []).map((assignment) => {
      ensureCrewMemberExists(db, assignment.crewMemberId);
      const startDate = normalizeDateOnly(assignment.startDate);
      const endDate = normalizeDateOnly(assignment.endDate);
      assertDateWindow(startDate, endDate, `${label} crew assignment`);
      return {
        crewMemberId: assignment.crewMemberId,
        roleLabel: normalizeOptionalText(assignment.roleLabel),
        startDate,
        endDate,
        notes: normalizeOptionalText(assignment.notes),
      };
    });

    const packingSeed =
      bucket.packingSeed?.mode === "existing"
        ? {
            mode: "existing" as const,
            packingSlipId: ensureValue(bucket.packingSeed.packingSlipId, `${label} packing slip`),
          }
        : bucket.packingSeed?.mode === "draft"
          ? {
              mode: "draft" as const,
              label: normalizeOptionalText(bucket.packingSeed.label),
              responsibleUserId: normalizeOptionalText(bucket.packingSeed.responsibleUserId),
              notes: normalizeOptionalText(bucket.packingSeed.notes),
            }
          : {
              mode: "none" as const,
            };

    if (packingSeed.mode === "draft" && packingSeed.responsibleUserId) {
      ensureUserExists(db, packingSeed.responsibleUserId, `${label} responsible user`);
    }

    return {
      departmentId,
      assetIds: uniqueValues(bucket.assetIds),
      crewAssignments: normalizedCrewAssignments,
      packingSeed,
    } satisfies NormalizedUnitDepartment;
  });

  const declaredDepartmentIds = normalizeDepartmentIds(unit.departmentIds);
  ensureDepartmentIdsExist(db, declaredDepartmentIds, `${label} department`);

  normalizedDepartments.forEach((bucket) => {
    if (!declaredDepartmentIds.includes(bucket.departmentId)) {
      throw new Error(`${label} has resources assigned to a department that is not enabled for that unit.`);
    }
  });

  return normalizedDepartments;
};

const assertUnitWindowsWithinProjectWindow = (
  projectStartDate: string | null,
  projectEndDate: string | null,
  windows: NormalizedUnitWindow[],
  label: string,
) => {
  windows.forEach((window) => {
    assertUnitWithinProjectWindow(projectStartDate, projectEndDate, window.startDate, window.endDate);
    assertDateWindow(window.startDate, window.endDate, `${label} window`);
  });
};

const windowsOverlap = (leftWindows: Array<{ startDate: string | null; endDate: string | null }>, rightWindows: Array<{ startDate: string | null; endDate: string | null }>) =>
  leftWindows.some((leftWindow) =>
    rightWindows.some((rightWindow) => resolveDateOverlap(leftWindow.startDate, leftWindow.endDate, rightWindow.startDate, rightWindow.endDate)),
  );

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

const buildGeneratedProjectCodeBase = (projectName: string) => {
  const tokens = projectName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length >= 2) {
    const initials = tokens
      .slice(0, 4)
      .map((token) => token[0] ?? "")
      .join("");
    return normalizeCodeToken(initials) || "PRJ";
  }

  if (tokens.length === 1) {
    return normalizeCodeToken(tokens[0]!.slice(0, 6)) || "PRJ";
  }

  return "PRJ";
};

const resolveBlueprintProjectCode = (db: DatabaseSync, inputCode: string | undefined, projectName: string) => {
  const explicitCode = inputCode?.trim();

  if (explicitCode) {
    const normalizedCode = ensureValue(explicitCode, "Project code").toUpperCase();
    assertCodeAvailability(db, normalizedCode);
    return normalizedCode;
  }

  const baseCode = buildGeneratedProjectCodeBase(projectName);

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidateCode = attempt === 0 ? baseCode : `${baseCode}-${attempt + 1}`;

    try {
      assertCodeAvailability(db, candidateCode);
      return candidateCode;
    } catch {
      continue;
    }
  }

  throw new Error("Unable to generate a unique project code automatically.");
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
    const name = ensureValue(input.generalInfo.name, "Project name");
    const code = resolveBlueprintProjectCode(db, input.generalInfo.code, name);
    const client = resolveClientReference(db, input.generalInfo);
    const productionCompany = resolveProductionCompanyReference(db, input.generalInfo);
    const startDate = normalizeDateOnly(input.generalInfo.startDate);
    const endDate = normalizeDateOnly(input.generalInfo.endDate);
    const hasPreproduction = Boolean(input.generalInfo.hasPreproduction);
    const preproductionStartDate = normalizeDateOnly(input.generalInfo.preproductionStartDate);
    const preproductionEndDate = normalizeDateOnly(input.generalInfo.preproductionEndDate);
    const colorKey = normalizeColorKey(input.generalInfo.colorKey);
    const projectDepartmentIds = normalizeDepartmentIds(input.generalInfo.departmentIds);
    const projectId = `project-${slugify(code)}-${Date.now().toString(36)}`;
    const mainUnitId = `unit-${slugify(projectId)}-main`;
    const defaultActorUserId = "user-ops";
    const defaultCommandId = `project-setup-${Date.now().toString(36)}`;

    assertDateWindow(startDate, endDate, "Project");
    assertPreproductionWindow(hasPreproduction, preproductionStartDate, preproductionEndDate, startDate);
    ensureDepartmentIdsExist(db, projectDepartmentIds, "Project department");

    const departmentRows = projectDepartmentIds.length
      ? (db
          .prepare(`SELECT id, name FROM departments WHERE id IN (${projectDepartmentIds.map(() => "?").join(", ")})`)
          .all(...projectDepartmentIds) as Array<{ id: string; name: string }>)
      : [];
    const departmentNameById = new Map(departmentRows.map((row) => [row.id, row.name] as const));

    const mainUnitWindows: NormalizedUnitWindow[] = [
      {
        id: `unit-window-${slugify(code)}-main`,
        startDate,
        endDate,
        sortOrder: 0,
        label: null,
      },
    ];

    const normalizedMainUnit = {
      id: mainUnitId,
      code: "MAIN",
      name: "Main Unit",
      sortOrder: 0,
      colorKey,
      startDate,
      endDate,
      windows: mainUnitWindows,
      notes: normalizeOptionalText(input.mainUnit.notes),
      departmentIds: normalizeDepartmentIds(input.mainUnit.departmentIds),
      unitDepartments: normalizeUnitDepartments(db, input.mainUnit, projectDepartmentIds, "Main Unit"),
    };

    normalizedMainUnit.departmentIds.forEach((departmentId) => {
      if (!projectDepartmentIds.includes(departmentId)) {
        throw new Error("Main Unit uses a department outside the project pool.");
      }
    });

    const normalizedAdditionalUnits = input.additionalUnits.map((unit, index) => {
      const unitWindows = normalizeUnitWindows(unit.windows, unit.name || `Additional unit ${index + 1}`);
      const resolvedCode = ensureValue(unit.code?.trim() || `${code}-${index + 2}U`, "Unit code").toUpperCase();
      assertUnitWindowsWithinProjectWindow(startDate, endDate, unitWindows, "Project unit");
      const unitBounds = deriveUnitBoundsFromWindows(unitWindows);
      assertProjectUnitCodeAvailability(db, projectId, resolvedCode);

      const departmentIds = normalizeDepartmentIds(unit.departmentIds);
      ensureDepartmentIdsExist(db, departmentIds, "Unit department");
      departmentIds.forEach((departmentId) => {
        if (!projectDepartmentIds.includes(departmentId)) {
          throw new Error(`${unit.name || `Additional unit ${index + 1}`} uses a department outside the project pool.`);
        }
      });

      return {
        ...unit,
        code: resolvedCode,
        id: unit.id?.trim() || `unit-${slugify(projectId)}-${slugify(resolvedCode)}-${Date.now().toString(36)}-${index}`,
        sortOrder: unit.sortOrder ?? index + 1,
        startDate: unitBounds.startDate,
        endDate: unitBounds.endDate,
        windows: unitWindows,
        notes: normalizeOptionalText(unit.notes),
        departmentIds,
        unitDepartments: normalizeUnitDepartments(db, unit, projectDepartmentIds, unit.name || `Additional unit ${index + 1}`),
      };
    });

    const crewAssignmentDrafts = [
      ...normalizedMainUnit.unitDepartments.flatMap((bucket) =>
        bucket.crewAssignments.map((assignment) => ({
          ...assignment,
          departmentId: bucket.departmentId,
          departmentName: departmentNameById.get(bucket.departmentId) ?? "Department",
          unitId: normalizedMainUnit.id,
          unitName: normalizedMainUnit.name,
          unitWindows: normalizedMainUnit.windows,
          unitStartDate: startDate,
          unitEndDate: endDate,
        })),
      ),
      ...normalizedAdditionalUnits.flatMap((unit) =>
        unit.unitDepartments.flatMap((bucket) =>
          bucket.crewAssignments.map((assignment) => ({
            ...assignment,
            departmentId: bucket.departmentId,
            departmentName: departmentNameById.get(bucket.departmentId) ?? "Department",
            unitId: unit.id!,
            unitName: unit.name,
            unitWindows: unit.windows,
            unitStartDate: unit.startDate ?? null,
            unitEndDate: unit.endDate ?? null,
          })),
        ),
      ),
    ];

    crewAssignmentDrafts.forEach((assignment) => {
      const assignmentStartDate = normalizeDateOnly(assignment.startDate);
      const assignmentEndDate = normalizeDateOnly(assignment.endDate);
      assertDateWindow(assignmentStartDate, assignmentEndDate, "Crew assignment");
      assertUnitWithinProjectWindow(assignment.unitStartDate, assignment.unitEndDate, assignmentStartDate, assignmentEndDate);
    });

    for (let index = 0; index < crewAssignmentDrafts.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < crewAssignmentDrafts.length; nextIndex += 1) {
        const left = crewAssignmentDrafts[index];
        const right = crewAssignmentDrafts[nextIndex];

        if (left.crewMemberId !== right.crewMemberId) {
          continue;
        }

        const leftWindows =
          left.startDate || left.endDate
            ? [{ startDate: normalizeDateOnly(left.startDate), endDate: normalizeDateOnly(left.endDate) }]
            : left.unitWindows;
        const rightWindows =
          right.startDate || right.endDate
            ? [{ startDate: normalizeDateOnly(right.startDate), endDate: normalizeDateOnly(right.endDate) }]
            : right.unitWindows;

        if (!windowsOverlap(leftWindows, rightWindows)) {
          continue;
        }

        const crewMember = db
          .prepare("SELECT COALESCE(full_name, 'Crew member') AS full_name FROM crew_members WHERE id = ? LIMIT 1")
          .get(left.crewMemberId) as { full_name: string } | undefined;

        throw new Error(
          `${crewMember?.full_name ?? "Crew member"} overlaps within this setup between ${left.unitName} / ${left.departmentName} and ${right.unitName} / ${right.departmentName}. Reassign that crew member first.`,
        );
      }
    }

    const assignmentBuckets = [
      {
        unitId: normalizedMainUnit.id,
        unitName: normalizedMainUnit.name,
        windows: normalizedMainUnit.windows,
        unitEndDate: endDate,
        departments: normalizedMainUnit.unitDepartments,
      },
      ...normalizedAdditionalUnits.map((unit) => ({
        unitId: unit.id!,
        unitName: unit.name,
        windows: unit.windows,
        unitEndDate: unit.endDate ?? endDate,
        departments: unit.unitDepartments,
      })),
    ];

    const allAssetAssignments = assignmentBuckets.flatMap((unit) =>
      unit.departments.map((bucket) => ({
        unitId: unit.unitId,
        unitName: unit.unitName,
        windows: unit.windows,
        unitEndDate: unit.unitEndDate,
        departmentId: bucket.departmentId,
        departmentName: departmentNameById.get(bucket.departmentId) ?? "Department",
        assetIds: bucket.assetIds,
        packingSeed: bucket.packingSeed,
      })),
    );

    allAssetAssignments.forEach((bucket) => ensureAssetIdsExist(db, bucket.assetIds));

    for (let index = 0; index < allAssetAssignments.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < allAssetAssignments.length; nextIndex += 1) {
        const left = allAssetAssignments[index];
        const right = allAssetAssignments[nextIndex];

        if (!windowsOverlap(left.windows, right.windows)) {
          continue;
        }

        const duplicateAssetId = left.assetIds.find((assetId) => right.assetIds.includes(assetId));
        if (!duplicateAssetId) {
          continue;
        }

        const asset = db
          .prepare("SELECT name FROM assets WHERE id = ? LIMIT 1")
          .get(duplicateAssetId) as { name: string } | undefined;

        throw new Error(
          `${asset?.name ?? "Asset"} overlaps within this setup between ${left.unitName} / ${left.departmentName} and ${right.unitName} / ${right.departmentName}. Reassign that asset first.`,
        );
      }
    }

    const conflictingProjectsByAsset = uniqueValues(allAssetAssignments.flatMap((bucket) => bucket.assetIds));

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
              project_units.name AS unit_name,
              project_units.status AS unit_status,
              departments.name AS department_name,
              COALESCE(project_unit_windows.start_date, project_units.start_date, projects.start_date) AS start_date,
              COALESCE(project_unit_windows.end_date, project_units.end_date, projects.end_date) AS end_date
            FROM asset_current_state
            JOIN assets ON assets.id = asset_current_state.asset_id
            LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
            LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
            LEFT JOIN departments ON departments.id = asset_current_state.current_department_id
            LEFT JOIN project_unit_windows ON project_unit_windows.project_unit_id = project_units.id
            WHERE asset_current_state.asset_id IN (${placeholders})
              AND asset_current_state.current_project_id IS NOT NULL
          `,
        )
        .all(...conflictingProjectsByAsset) as Array<{
        asset_id: string;
        asset_name: string;
        project_name: string | null;
        project_status: string | null;
        unit_name: string | null;
        unit_status: string | null;
        department_name: string | null;
        start_date: string | null;
        end_date: string | null;
      }>;

      const conflictingAsset = assetRows.find((row) => {
        if (!row.project_status || !row.project_name || row.project_status === "Wrapped" || row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return false;
        }

        return allAssetAssignments.some(
          (bucket) =>
            bucket.assetIds.includes(row.asset_id) &&
            windowsOverlap(bucket.windows, [{ startDate: row.start_date, endDate: row.end_date }]),
        );
      });

      if (conflictingAsset) {
        throw new Error(
          `${conflictingAsset.asset_name} overlaps with ${conflictingAsset.project_name} / ${conflictingAsset.unit_name ?? "Main Unit"}${conflictingAsset.department_name ? ` / ${conflictingAsset.department_name}` : ""}. Resolve that asset conflict first.`,
        );
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
              departments.name AS department_name,
              COALESCE(project_unit_crew_assignments.start_date, project_units.start_date, projects.start_date) AS start_date,
              COALESCE(project_unit_crew_assignments.end_date, project_units.end_date, projects.end_date) AS end_date
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            JOIN projects ON projects.id = project_units.project_id
            LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
            LEFT JOIN departments ON departments.id = project_unit_crew_assignments.department_id
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
        department_name: string | null;
        start_date: string | null;
        end_date: string | null;
      }>;

      const conflictingCrew = crewRows.find((row) => {
        if (row.project_status === "Wrapped" || row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return false;
        }

        return crewAssignmentDrafts.some((assignment) => {
          const assignmentWindows =
            assignment.startDate || assignment.endDate
              ? [{ startDate: normalizeDateOnly(assignment.startDate), endDate: normalizeDateOnly(assignment.endDate) }]
              : assignment.unitWindows;
          return (
            assignment.crewMemberId === row.crew_member_id &&
            windowsOverlap(assignmentWindows, [{ startDate: row.start_date, endDate: row.end_date }])
          );
        });
      });

      if (conflictingCrew) {
        throw new Error(
          `${conflictingCrew.crew_name} overlaps with ${conflictingCrew.project_name} / ${conflictingCrew.unit_name}${conflictingCrew.department_name ? ` / ${conflictingCrew.department_name}` : ""}. Resolve that crew conflict first.`,
        );
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

      const insertProjectDepartment = db.prepare(
        `
          INSERT OR IGNORE INTO project_departments (project_id, department_id, created_at)
          VALUES (?, ?, ?)
        `,
      );
      projectDepartmentIds.forEach((departmentId) => insertProjectDepartment.run(projectId, departmentId, now));

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
      const insertUnitWindow = db.prepare(
        `
          INSERT INTO project_unit_windows (
            id,
            project_unit_id,
            start_date,
            end_date,
            sort_order,
            label,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      const insertUnitDepartment = db.prepare(
        `
          INSERT OR IGNORE INTO project_unit_departments (project_unit_id, department_id, created_at)
          VALUES (?, ?, ?)
        `,
      );

      const mainDerived = resolveDerivedStatusRow(startDate, endDate, null, null);
      insertUnit.run(
        normalizedMainUnit.id,
        workspaceId,
        projectId,
        normalizedMainUnit.code,
        normalizedMainUnit.name,
        0,
        mainDerived.status,
        mainDerived.statusSource,
        colorKey,
        startDate,
        endDate,
        normalizedMainUnit.notes,
        1,
        now,
        now,
      );
      normalizedMainUnit.windows.forEach((window, index) => {
        insertUnitWindow.run(window.id || `unit-window-${normalizedMainUnit.id}-${index}`, normalizedMainUnit.id, window.startDate, window.endDate, window.sortOrder, window.label, now, now);
      });
      normalizedMainUnit.departmentIds.forEach((departmentId) => insertUnitDepartment.run(normalizedMainUnit.id, departmentId, now));

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
          unit.notes,
          0,
          now,
          now,
        );
        unit.windows.forEach((window, index) => {
          insertUnitWindow.run(window.id || `unit-window-${unit.id}-${index}`, unit.id, window.startDate, window.endDate, window.sortOrder, window.label, now, now);
        });
        unit.departmentIds.forEach((departmentId) => insertUnitDepartment.run(unit.id!, departmentId, now));
      });

      const insertCrewAssignment = db.prepare(
        `
          INSERT INTO project_unit_crew_assignments (
            id,
            workspace_id,
            project_unit_id,
            department_id,
            crew_member_id,
            role_label,
            start_date,
            end_date,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      crewAssignmentDrafts.forEach((assignment, index) => {
        insertCrewAssignment.run(
          `unit-crew-${Date.now().toString(36)}-${index}`,
          workspaceId,
          assignment.unitId,
          assignment.departmentId,
          assignment.crewMemberId,
          assignment.roleLabel,
          normalizeDateOnly(assignment.startDate) ?? assignment.unitStartDate,
          normalizeDateOnly(assignment.endDate) ?? assignment.unitEndDate,
          assignment.notes,
          now,
          now,
        );
      });

      const allAssetIds = uniqueValues(allAssetAssignments.flatMap((bucket) => bucket.assetIds));
      const assetRows = allAssetIds.length
        ? (db
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
                WHERE asset_current_state.asset_id IN (${allAssetIds.map(() => "?").join(", ")})
              `,
            )
            .all(...allAssetIds) as Array<{
            asset_id: string;
            current_location_id: string | null;
            current_department_id: string | null;
            current_responsible_user_id: string | null;
            active_assignment_id: string | null;
            condition_status: string;
            operational_status: string;
            custody_status: string;
          }>)
        : [];
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
            current_department_id = ?,
            project_unit_id = ?,
            active_assignment_id = ?,
            last_event_id = ?,
            custody_status = 'assigned',
            updated_at = ?,
            version = version + 1
          WHERE asset_id = ?
        `,
      );

      allAssetAssignments.forEach((bucket, unitIndex) => {
        bucket.assetIds.forEach((assetId, assetIndex) => {
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
            bucket.departmentId,
            bucket.unitId,
            assetRow.current_responsible_user_id,
            defaultActorUserId,
            assetRow.current_location_id,
            assetRow.current_location_id,
            "assigned",
            bucket.unitEndDate,
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
            bucket.departmentId,
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

          updateAssetState.run(projectId, bucket.departmentId, bucket.unitId, assignmentId, eventId, now, assetId);
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

      allAssetAssignments.forEach((bucket) => {
        const packingSeed = bucket.packingSeed ?? { mode: "none" as const };
        if (packingSeed.mode === "none") {
          return;
        }

        if (packingSeed.mode === "existing") {
          const existingSlip = db
            .prepare(
              `
                SELECT id, department_id
                FROM packing_slips
                WHERE id = ?
                  AND COALESCE(lifecycle_state, 'operational') = 'staging'
                LIMIT 1
              `,
            )
            .get(packingSeed.packingSlipId) as { id: string; department_id: string | null } | undefined;

          if (!existingSlip) {
            throw new Error("Selected staging packing slip was not found.");
          }

          if (existingSlip.department_id && existingSlip.department_id !== bucket.departmentId) {
            throw new Error(`Selected staging packing slip does not belong to ${bucket.departmentName}.`);
          }

          db.prepare(
            `
              UPDATE packing_slips
              SET
                project_id = ?,
                project_unit_id = ?,
                department_id = ?,
                lifecycle_state = 'operational',
                status = ?,
                issue_date = ?,
                updated_at = ?
              WHERE id = ?
            `,
          ).run(projectId, bucket.unitId, bucket.departmentId, bucket.assetIds.length ? "Issued" : "Draft", todayDateOnly(), now, existingSlip.id);

          syncPackingSlipItems(existingSlip.id, bucket.assetIds);
          return;
        }

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
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'operational', ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          nextPackingIdentifiers.packingSlipId,
          workspaceId,
          projectId,
          bucket.unitId,
          bucket.departmentId,
          defaultActorUserId,
          packingSeed.responsibleUserId ?? null,
          bucket.assetIds.length ? "Issued" : "Draft",
          todayDateOnly(),
          bucket.unitEndDate,
          packingSeed.notes ?? "Created during project setup wizard.",
          now,
          now,
        );

        syncPackingSlipItems(nextPackingIdentifiers.packingSlipId, bucket.assetIds);
      });

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

    const unitId = `unit-${slugify(input.projectId)}-${slugify(code)}-${Date.now().toString(36)}`;

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
      unitId,
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

    if (startDate && endDate) {
      db.prepare(
        `
          INSERT INTO project_unit_windows (
            id,
            project_unit_id,
            start_date,
            end_date,
            sort_order,
            label,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
        `,
      ).run(`unit-window-${unitId}-primary`, unitId, startDate, endDate, now, now);
    }
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

    db.prepare("DELETE FROM project_unit_windows WHERE project_unit_id = ?").run(input.unitId);

    if (startDate && endDate) {
      db.prepare(
        `
          INSERT INTO project_unit_windows (
            id,
            project_unit_id,
            start_date,
            end_date,
            sort_order,
            label,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
        `,
      ).run(`unit-window-${input.unitId}-primary`, input.unitId, startDate, endDate, now, now);
    }
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
