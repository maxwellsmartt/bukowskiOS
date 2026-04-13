import type { DatabaseSync } from "node:sqlite";

import type { CatalogSnapshot } from "@contracts";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
const activeProjectStatuses = new Set(["Prep", "Active", "On hold"]);

const mapAssetStatus = (operationalStatus: string, custodyStatus: string) => {
  if (operationalStatus === "maintenance") {
    return "Maintenance";
  }

  if (custodyStatus === "checked_out") {
    return "Checked out";
  }

  if (custodyStatus === "assigned") {
    return "Assigned";
  }

  return "Available";
};

export const createCatalogReadService = (db: DatabaseSync) => ({
  getSnapshot(): CatalogSnapshot {
    const locations = db
      .prepare(
        `
          SELECT id, code, name, type, COALESCE(description, '') AS description, is_active
          FROM locations
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      description: string;
      is_active: number;
    }>;

    const departments = db
      .prepare(
        `
          SELECT id, code, name, COALESCE(description, '') AS description, is_active
          FROM departments
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      code: string;
      name: string;
      description: string;
      is_active: number;
    }>;

    const users = db
      .prepare(
        `
          SELECT users.id, users.full_name
          FROM workspace_memberships
          JOIN users ON users.id = workspace_memberships.user_id
          WHERE workspace_memberships.workspace_id = ?
            AND workspace_memberships.status = 'active'
            AND users.is_active = 1
          ORDER BY users.full_name
        `,
      )
      .all(workspaceId) as Array<{ id: string; full_name: string }>;

    const crewMembers = db
      .prepare(
        `
          SELECT
            id,
            full_name,
            COALESCE(role_label, '') AS role_label,
            COALESCE(email, '') AS email,
            COALESCE(phone, '') AS phone,
            COALESCE(notes, '') AS notes,
            linked_user_id,
            is_active
          FROM crew_members
          WHERE workspace_id = ?
          ORDER BY is_active DESC, full_name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      full_name: string;
      role_label: string;
      email: string;
      phone: string;
      notes: string;
      linked_user_id: string | null;
      is_active: number;
    }>;

    const crewAssignments = db
      .prepare(
        `
          SELECT
            project_unit_crew_assignments.crew_member_id,
            projects.id AS project_id,
            projects.name AS project_name,
            projects.status AS project_status,
            project_units.id AS unit_id,
            COALESCE(project_units.name, 'Main Unit') AS unit_name,
            project_units.status AS unit_status,
            departments.id AS department_id,
            departments.name AS department_name,
            COALESCE(project_unit_crew_assignments.start_date, project_units.start_date, projects.start_date) AS assignment_start_date,
            COALESCE(project_unit_crew_assignments.end_date, project_units.end_date, projects.end_date) AS assignment_end_date
          FROM project_unit_crew_assignments
          JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
          JOIN projects ON projects.id = project_units.project_id
          LEFT JOIN departments ON departments.id = project_unit_crew_assignments.department_id
          WHERE project_units.workspace_id = ?
        `,
      )
      .all(workspaceId) as Array<{
      crew_member_id: string;
      project_id: string;
      project_name: string;
      project_status: string;
      unit_id: string | null;
      unit_name: string;
      unit_status: string;
      department_id: string | null;
      department_name: string | null;
      assignment_start_date: string | null;
      assignment_end_date: string | null;
    }>;

    const crewAssignmentsByMember = new Map<
      string,
      Array<{
        projectId: string;
        project: string;
        unitId: string | null;
        unit: string;
        departmentId: string | null;
        department: string | null;
        startDate: string | null;
        endDate: string | null;
      }>
    >();

    crewAssignments.forEach((row) => {
      if (!activeProjectStatuses.has(row.project_status)) {
        return;
      }

      if (row.unit_status === "cancelled" || row.unit_status === "wrapped") {
        return;
      }

      const assignments = crewAssignmentsByMember.get(row.crew_member_id) ?? [];
      assignments.push({
        projectId: row.project_id,
        project: row.project_name,
        unitId: row.unit_id,
        unit: row.unit_name,
        departmentId: row.department_id,
        department: row.department_name,
        startDate: row.assignment_start_date,
        endDate: row.assignment_end_date,
      });
      crewAssignmentsByMember.set(row.crew_member_id, assignments);
    });

    const clients = db
      .prepare(
        `
          SELECT
            id,
            name,
            COALESCE(contact_name, '') AS contact_name,
            COALESCE(email, '') AS email,
            COALESCE(phone, '') AS phone,
            COALESCE(notes, '') AS notes,
            is_active
          FROM clients
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      contact_name: string;
      email: string;
      phone: string;
      notes: string;
      is_active: number;
    }>;

    const productionCompanies = db
      .prepare(
        `
          SELECT
            id,
            name,
            COALESCE(contact_name, '') AS contact_name,
            COALESCE(email, '') AS email,
            COALESCE(phone, '') AS phone,
            COALESCE(notes, '') AS notes,
            is_active
          FROM production_companies
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      contact_name: string;
      email: string;
      phone: string;
      notes: string;
      is_active: number;
    }>;

    const manufacturers = db
      .prepare(
        `
          SELECT
            id,
            name,
            COALESCE(contact_name, '') AS contact_name,
            COALESCE(support_email, '') AS support_email,
            COALESCE(phone, '') AS phone,
            COALESCE(notes, '') AS notes,
            is_active
          FROM manufacturers
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      contact_name: string;
      support_email: string;
      phone: string;
      notes: string;
      is_active: number;
    }>;

    const categories = db
      .prepare(
        `
          SELECT
            id,
            code,
            name,
            COALESCE(description, '') AS description,
            COALESCE(is_active, 1) AS is_active
          FROM asset_categories
          WHERE workspace_id = ?
          ORDER BY is_active DESC, name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      code: string;
      name: string;
      description: string;
      is_active: number;
    }>;

    const kits = db
      .prepare(
        `
          SELECT
            kits.id,
            kits.code,
            kits.name,
            COALESCE(kits.description, '') AS description,
            COALESCE(kits.notes, '') AS notes,
            kits.is_active,
            COALESCE((
              SELECT COUNT(*)
              FROM kit_assets
              WHERE kit_assets.kit_id = kits.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT group_concat(asset_id, ',')
              FROM (
                SELECT asset_id
                FROM kit_assets
                WHERE kit_id = kits.id
                ORDER BY asset_id
              )
            ), '') AS asset_ids,
            COALESCE((
              SELECT code_value
              FROM scannable_codes
              WHERE entity_type = 'kit'
                AND entity_id = kits.id
                AND is_primary = 1
              LIMIT 1
            ), 'Pending') AS primary_code_value
          FROM kits
          WHERE kits.workspace_id = ?
          ORDER BY kits.is_active DESC, kits.name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      code: string;
      name: string;
      description: string;
      notes: string;
      is_active: number;
      asset_count: number;
      asset_ids: string;
      primary_code_value: string;
    }>;

    const assetOptions = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_categories.name AS category,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.current_project_id,
            projects.name AS current_project_name,
            asset_current_state.current_department_id,
            departments.name AS current_department_name,
            asset_current_state.project_unit_id,
            project_units.name AS current_unit_name
          FROM assets
          JOIN asset_categories ON asset_categories.id = assets.category_id
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          LEFT JOIN departments ON departments.id = asset_current_state.current_department_id
          LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          WHERE assets.workspace_id = ?
            AND assets.is_active = 1
          ORDER BY assets.name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      code: string;
      category: string;
      operational_status: string;
      custody_status: string;
      current_project_id: string | null;
      current_project_name: string | null;
      current_department_id: string | null;
      current_department_name: string | null;
      project_unit_id: string | null;
      current_unit_name: string | null;
    }>;

    return {
      locations: locations.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        description: row.description,
        isActive: Boolean(row.is_active),
      })),
      departments: departments.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
      })),
      users: users.map((row) => ({
        id: row.id,
        fullName: row.full_name,
      })),
      crewMembers: crewMembers.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        roleLabel: row.role_label,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        isActive: Boolean(row.is_active),
        linkedUserId: row.linked_user_id,
        activeAssignments: crewAssignmentsByMember.get(row.id) ?? [],
      })),
      clients: clients.map((row) => ({
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        isActive: Boolean(row.is_active),
      })),
      productionCompanies: productionCompanies.map((row) => ({
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        isActive: Boolean(row.is_active),
      })),
      manufacturers: manufacturers.map((row) => ({
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        supportEmail: row.support_email,
        phone: row.phone,
        notes: row.notes,
        isActive: Boolean(row.is_active),
      })),
      categories: categories.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
      })),
      kits: kits.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        notes: row.notes,
        isActive: Boolean(row.is_active),
        assetCount: row.asset_count,
        assetIds: row.asset_ids ? row.asset_ids.split(",").filter(Boolean) : [],
        primaryCodeValue: row.primary_code_value,
      })),
      assetOptions: assetOptions.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        category: row.category,
        status: mapAssetStatus(row.operational_status, row.custody_status),
        currentProjectId: row.current_project_id,
        currentProject: row.current_project_name,
        currentDepartmentId: row.current_department_id,
        currentDepartment: row.current_department_name,
        currentUnitId: row.project_unit_id,
        currentUnit: row.current_unit_name,
      })),
    };
  },
});

export type CatalogReadService = ReturnType<typeof createCatalogReadService>;
