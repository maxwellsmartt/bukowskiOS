import type { DatabaseSync } from "node:sqlite";

import { createCodeGenerationService } from "./codeGenerationService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const operationalPermissions = [
  ["perm-assets-read", "assets.read", "Read assets", "View asset registry and current state"],
  ["perm-assets-manage", "assets.manage", "Manage assets", "Create movements and update assets"],
  ["perm-incidents-read", "incidents.read", "Read incidents", "View incident queues and details"],
  ["perm-incidents-create", "incidents.create", "Create incidents", "Report new incidents"],
  ["perm-rma-read", "rma.read", "Read RMAs", "Review RMA queues and manufacturer cases"],
  ["perm-rma-create", "rma.create", "Create RMAs", "Open or prepare new RMA cases"],
  ["perm-packing-read", "packing-slips.read", "Read packing slips", "View packing slip detail and status"],
  ["perm-packing-create", "packing-slips.create", "Create packing slips", "Issue new packing slips"],
  ["perm-finance-read", "finance.read", "Read finance shell", "View finance exposure and entries"],
] as const;

const operationalRoles = [
  ["role-admin", "admin", "Admin", "Full operational access", 1],
  ["role-supervisor", "supervisor", "Supervisor", "Supervise operations and incidents", 0],
  ["role-operations-supervisor", "operations_supervisor", "Operations Supervisor", "Coordinate incidents, RMAs and packing flows", 0],
  ["role-vtr-operator", "vtr_operator", "VTR Operator", "Report set issues and work with VTR equipment context", 0],
  ["role-logistics-operator", "logistics_operator", "Logistics Operator", "Handle packing flows and asset dispatch", 0],
  ["role-maintenance-operator", "maintenance_operator", "Maintenance Operator", "Handle incidents, repairs and RMAs", 0],
  ["role-finance-viewer", "finance_viewer", "Finance Viewer", "Review finance status without edit privileges", 0],
] as const;

const operationalRolePermissions = [
  ["role-admin", "perm-assets-read"],
  ["role-admin", "perm-assets-manage"],
  ["role-admin", "perm-incidents-read"],
  ["role-admin", "perm-incidents-create"],
  ["role-admin", "perm-rma-read"],
  ["role-admin", "perm-rma-create"],
  ["role-admin", "perm-packing-read"],
  ["role-admin", "perm-packing-create"],
  ["role-admin", "perm-finance-read"],
  ["role-supervisor", "perm-assets-read"],
  ["role-supervisor", "perm-incidents-read"],
  ["role-supervisor", "perm-incidents-create"],
  ["role-supervisor", "perm-rma-read"],
  ["role-supervisor", "perm-rma-create"],
  ["role-supervisor", "perm-packing-read"],
  ["role-supervisor", "perm-packing-create"],
  ["role-supervisor", "perm-finance-read"],
  ["role-operations-supervisor", "perm-assets-read"],
  ["role-operations-supervisor", "perm-assets-manage"],
  ["role-operations-supervisor", "perm-incidents-read"],
  ["role-operations-supervisor", "perm-incidents-create"],
  ["role-operations-supervisor", "perm-rma-read"],
  ["role-operations-supervisor", "perm-rma-create"],
  ["role-operations-supervisor", "perm-packing-read"],
  ["role-operations-supervisor", "perm-packing-create"],
  ["role-vtr-operator", "perm-assets-read"],
  ["role-vtr-operator", "perm-incidents-read"],
  ["role-vtr-operator", "perm-incidents-create"],
  ["role-vtr-operator", "perm-rma-read"],
  ["role-vtr-operator", "perm-rma-create"],
  ["role-logistics-operator", "perm-assets-read"],
  ["role-logistics-operator", "perm-assets-manage"],
  ["role-logistics-operator", "perm-packing-read"],
  ["role-logistics-operator", "perm-packing-create"],
  ["role-maintenance-operator", "perm-assets-read"],
  ["role-maintenance-operator", "perm-incidents-read"],
  ["role-maintenance-operator", "perm-incidents-create"],
  ["role-maintenance-operator", "perm-rma-read"],
  ["role-maintenance-operator", "perm-rma-create"],
  ["role-finance-viewer", "perm-finance-read"],
] as const;

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

export const applyAdminFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "projects", "client_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id);");
  }

  if (!hasColumn(db, "asset_categories", "is_active")) {
    db.exec("ALTER TABLE asset_categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }
};

export const bootstrapAdminFoundation = (db: DatabaseSync) => {
  applyAdminFoundationMigration(db);

  const codeService = createCodeGenerationService(db);
  const now = new Date().toISOString();

  db.exec("BEGIN");

  try {
    operationalPermissions.forEach(([id, key, label, description]) => {
      db.prepare(
        `
          INSERT OR IGNORE INTO permissions (id, key, label, description)
          VALUES (?, ?, ?, ?)
        `,
      ).run(id, key, label, description);
    });

    operationalRoles.forEach(([id, key, name, description, isSystemRole]) => {
      db.prepare(
        `
          INSERT OR IGNORE INTO roles (id, workspace_id, key, name, description, is_system_role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(id, workspaceId, key, name, description, isSystemRole, now);
    });

    operationalRolePermissions.forEach(([roleId, permissionId]) => {
      db.prepare(
        `
          INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at)
          VALUES (?, ?, ?)
        `,
      ).run(roleId, permissionId, now);
    });

    const projectsWithClients = db
      .prepare(
        `
          SELECT id, client_name
          FROM projects
          WHERE workspace_id = ?
            AND client_name IS NOT NULL
            AND trim(client_name) != ''
        `,
      )
      .all(workspaceId) as Array<{ id: string; client_name: string }>;

    projectsWithClients.forEach((project) => {
      const clientName = project.client_name.trim();
      const clientId = `client-${slugify(clientName)}`;

      db.prepare(
        `
          INSERT OR IGNORE INTO clients (
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
          VALUES (?, ?, ?, NULL, NULL, NULL, 'Backfilled from project registry.', 1, ?, ?)
        `,
      ).run(clientId, workspaceId, clientName, now, now);

      db.prepare(
        `
          UPDATE projects
          SET client_id = ?
          WHERE id = ?
            AND (client_id IS NULL OR client_id = '')
        `,
      ).run(clientId, project.id);
    });

    const users = db
      .prepare(
        `
          SELECT id, full_name, email, phone
          FROM users
          WHERE is_active = 1
        `,
      )
      .all() as Array<{ id: string; full_name: string; email: string; phone: string | null }>;

    users.forEach((user) => {
      db.prepare(
        `
          INSERT OR IGNORE INTO crew_members (
            id,
            workspace_id,
            full_name,
            role_label,
            email,
            phone,
            notes,
            is_active,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'Core crew', ?, ?, 'Backfilled from users registry.', 1, ?, ?)
        `,
      ).run(`crew-${user.id}`, workspaceId, user.full_name, user.email, user.phone, now, now);
    });

    const assets = db
      .prepare(
        `
          SELECT id, internal_code, qr_code_value
          FROM assets
          WHERE workspace_id = ?
        `,
      )
      .all(workspaceId) as Array<{ id: string; internal_code: string; qr_code_value: string | null }>;

    assets.forEach((asset) => {
      codeService.ensurePrimaryCode({
        workspaceId,
        entityType: "asset",
        entityId: asset.id,
        preferredCodeValue: asset.qr_code_value?.trim() || `AST-${asset.internal_code}`,
      });
    });

    const packingSlips = db
      .prepare("SELECT id FROM packing_slips WHERE workspace_id = ?")
      .all(workspaceId) as Array<{ id: string }>;

    packingSlips.forEach((slip) => {
      codeService.ensurePrimaryCode({
        workspaceId,
        entityType: "packing_slip",
        entityId: slip.id,
        preferredCodeValue: slip.id.replace("packing-", "PS-"),
      });
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
