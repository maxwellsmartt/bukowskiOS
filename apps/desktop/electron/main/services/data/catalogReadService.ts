import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import type { CatalogListQuery, CatalogSnapshot } from "@contracts";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const activeProjectStatuses = new Set(["Prep", "Active", "On hold"]);
const maxInlinePreviewBytes = 5 * 1024 * 1024;

const mapAssetStatus = (
  operationalStatus: string,
  custodyStatus: string,
  availableQuantity: number,
  assignedQuantity: number,
  checkedOutQuantity: number,
) => {
  if (operationalStatus === "maintenance") {
    return "Maintenance";
  }

  if (checkedOutQuantity > 0 && assignedQuantity > 0) {
    return "Split allocation";
  }

  if (custodyStatus === "partial_checked_out") {
    return `Partial checkout (${checkedOutQuantity}/${availableQuantity + checkedOutQuantity})`;
  }

  if (custodyStatus === "partial_assigned") {
    return `Partial assigned (${assignedQuantity}/${availableQuantity + assignedQuantity})`;
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
  getSnapshot(query?: Pick<CatalogListQuery, "workspaceId">): CatalogSnapshot {
    const workspaceId = query?.workspaceId ?? DEFAULT_WORKSPACE_ID;
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
            crew_members.id,
            crew_members.full_name,
            crew_members.primary_department_id,
            departments.name AS primary_department_name,
            COALESCE(crew_members.document_id, '') AS document_id,
            COALESCE(role_label, '') AS role_label,
            COALESCE(email, '') AS email,
            COALESCE(phone, '') AS phone,
            COALESCE(notes, '') AS notes,
            crew_members.linked_user_id,
            crew_members.is_active
          FROM crew_members
          LEFT JOIN departments ON departments.id = crew_members.primary_department_id
          WHERE crew_members.workspace_id = ?
          ORDER BY crew_members.is_active DESC, crew_members.full_name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      full_name: string;
      primary_department_id: string | null;
      primary_department_name: string | null;
      document_id: string;
      role_label: string;
      email: string;
      phone: string;
      notes: string;
      linked_user_id: string | null;
      is_active: number;
    }>;

    const crewDocuments = db
      .prepare(
        `
          SELECT
            id,
            crew_member_id,
            file_type,
            COALESCE(storage_path, '') AS storage_path,
            COALESCE(original_name, '') AS original_name,
            COALESCE(byte_size, 0) AS byte_size,
            COALESCE(mime_type, 'application/octet-stream') AS mime_type,
            COALESCE(status, 'available') AS status,
            uploaded_at
          FROM crew_documents
          WHERE deleted_at IS NULL
          ORDER BY uploaded_at DESC, original_name
        `,
      )
      .all() as Array<{
      id: string;
      crew_member_id: string;
      file_type: string;
      storage_path: string;
      original_name: string;
      byte_size: number;
      mime_type: string;
      status: "available" | "missing" | "deleted";
      uploaded_at: string;
    }>;

    const crewBankAccounts = db
      .prepare(
        `
          SELECT
            id,
            crew_member_id,
            COALESCE(bank_name, '') AS bank_name,
            COALESCE(account_holder, '') AS account_holder,
            account_number,
            COALESCE(account_type, '') AS account_type,
            COALESCE(routing_number, '') AS routing_number,
            COALESCE(notes, '') AS notes,
            COALESCE(mask_in_preview, 1) AS mask_in_preview
          FROM crew_bank_accounts
          ORDER BY crew_member_id, sort_order, created_at
        `,
      )
      .all() as Array<{
      id: string;
      crew_member_id: string;
      bank_name: string;
      account_holder: string;
      account_number: string;
      account_type: string;
      routing_number: string;
      notes: string;
      mask_in_preview: number;
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

    const crewDocumentsByMember = new Map<string, CatalogSnapshot["crewMembers"][number]["documents"]>();
    const crewBankAccountsByMember = new Map<string, CatalogSnapshot["crewMembers"][number]["bankAccounts"]>();

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

    crewDocuments.forEach((row) => {
      let previewDataUrl: string | null = null;

      if (row.storage_path && row.status === "available" && row.byte_size <= maxInlinePreviewBytes && fs.existsSync(row.storage_path)) {
        const encoded = fs.readFileSync(row.storage_path).toString("base64");
        previewDataUrl = `data:${row.mime_type};base64,${encoded}`;
      }

      const documents = crewDocumentsByMember.get(row.crew_member_id) ?? [];
      documents.push({
        id: row.id,
        fileType: row.file_type,
        originalName: row.original_name,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        status: row.status,
        createdAt: row.uploaded_at,
        isPreviewable: row.mime_type.startsWith("image/") || row.mime_type === "application/pdf",
        previewDataUrl,
      });
      crewDocumentsByMember.set(row.crew_member_id, documents);
    });

    crewBankAccounts.forEach((row) => {
      const accounts = crewBankAccountsByMember.get(row.crew_member_id) ?? [];
      const normalizedNumber = row.account_number.trim();
      const maskedDigits = normalizedNumber.slice(-4);
      accounts.push({
        id: row.id,
        bankName: row.bank_name,
        accountHolder: row.account_holder,
        accountNumber: normalizedNumber,
        accountType: row.account_type,
        routingNumber: row.routing_number,
        notes: row.notes,
        maskInPreview: Boolean(row.mask_in_preview),
        maskedAccountNumber:
          normalizedNumber.length <= 4 ? normalizedNumber : `${"•".repeat(Math.max(0, normalizedNumber.length - 4))}${maskedDigits}`,
      });
      crewBankAccountsByMember.set(row.crew_member_id, accounts);
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
              SELECT COALESCE(SUM(quantity), 0)
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

    const kitAssetSelections = db
      .prepare(
        `
          SELECT kit_id, asset_id, quantity
          FROM kit_assets
          ORDER BY kit_id, asset_id
        `,
      )
      .all() as Array<{
      kit_id: string;
      asset_id: string;
      quantity: number;
    }>;

    const kitSelectionsById = new Map<string, Array<{ assetId: string; quantity: number }>>();
    kitAssetSelections.forEach((row) => {
      const current = kitSelectionsById.get(row.kit_id) ?? [];
      current.push({
        assetId: row.asset_id,
        quantity: row.quantity,
      });
      kitSelectionsById.set(row.kit_id, current);
    });

    const assetOptions = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_categories.name AS category,
            asset_current_state.total_quantity,
            asset_current_state.available_quantity AS quantity,
            asset_current_state.assigned_quantity,
            asset_current_state.checked_out_quantity,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.current_project_id,
            projects.name AS current_project_name,
            asset_current_state.current_department_id,
            departments.name AS current_department_name,
            asset_current_state.project_unit_id,
            project_units.name AS current_unit_name,
            (
              SELECT COUNT(*)
              FROM kit_assets
              JOIN kits ON kits.id = kit_assets.kit_id
              WHERE kit_assets.asset_id = assets.id
                AND kits.is_active = 1
                AND kits.workspace_id = assets.workspace_id
            ) AS linked_kit_count,
            COALESCE((
              SELECT group_concat(kits.code, ',')
              FROM kit_assets
              JOIN kits ON kits.id = kit_assets.kit_id
              WHERE kit_assets.asset_id = assets.id
                AND kits.is_active = 1
                AND kits.workspace_id = assets.workspace_id
            ), '') AS linked_kit_codes,
            COALESCE((
              SELECT group_concat(kits.name, ',')
              FROM kit_assets
              JOIN kits ON kits.id = kit_assets.kit_id
              WHERE kit_assets.asset_id = assets.id
                AND kits.is_active = 1
                AND kits.workspace_id = assets.workspace_id
            ), '') AS linked_kit_names
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
      total_quantity: number;
      quantity: number;
      assigned_quantity: number;
      checked_out_quantity: number;
      operational_status: string;
      custody_status: string;
      current_project_id: string | null;
      current_project_name: string | null;
      current_department_id: string | null;
      current_department_name: string | null;
      project_unit_id: string | null;
      current_unit_name: string | null;
      linked_kit_count: number;
      linked_kit_codes: string;
      linked_kit_names: string;
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
        primaryDepartmentId: row.primary_department_id,
        primaryDepartment: row.primary_department_name,
        documentId: row.document_id,
        roleLabel: row.role_label,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        isActive: Boolean(row.is_active),
        linkedUserId: row.linked_user_id,
        documents: crewDocumentsByMember.get(row.id) ?? [],
        bankAccounts: crewBankAccountsByMember.get(row.id) ?? [],
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
        assetSelections: kitSelectionsById.get(row.id) ?? [],
        primaryCodeValue: row.primary_code_value,
      })),
      assetOptions: assetOptions.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        category: row.category,
        quantity: row.quantity,
        totalQuantity: row.total_quantity,
        assignedQuantity: row.assigned_quantity,
        checkedOutQuantity: row.checked_out_quantity,
        operationalStatus: row.operational_status,
        custodyStatus: row.custody_status,
        status: mapAssetStatus(
          row.operational_status,
          row.custody_status,
          row.quantity,
          row.assigned_quantity,
          row.checked_out_quantity,
        ),
        currentProjectId: row.current_project_id,
        currentProject: row.current_project_name,
        currentDepartmentId: row.current_department_id,
        currentDepartment: row.current_department_name,
        currentUnitId: row.project_unit_id,
        currentUnit: row.current_unit_name,
        linkedKitCount: row.linked_kit_count,
        linkedKitCodes: row.linked_kit_codes ? row.linked_kit_codes.split(",").filter(Boolean) : [],
        linkedKitNames: row.linked_kit_names ? row.linked_kit_names.split(",").filter(Boolean) : [],
      })),
    };
  },
});

export type CatalogReadService = ReturnType<typeof createCatalogReadService>;
