import type { DatabaseSync } from "node:sqlite";

import { createCodeGenerationService } from "./codeGenerationService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const operationalPermissions = [
  ["perm-projects-read", "projects.read", "Read projects", "View project registry, details and schedule"],
  ["perm-projects-manage", "projects.manage", "Manage projects", "Create, edit and archive projects"],
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
  ["role-admin", "admin", "Admin", "Full access to settings, team, assets, projects and finance.", 1],
  ["role-crew", "crew", "Crew", "Report incidents and follow assigned equipment work.", 0],
  ["role-supervisor", "supervisor", "Supervisor", "Coordinate projects, assets, incidents, RMAs and packing slips.", 0],
  ["role-finance-viewer", "finance_viewer", "Finance Viewer", "Review finance status without edit access.", 0],
  ["role-maintenance", "maintenance", "Maintenance", "Handle incidents, repairs and RMA follow-up.", 0],
] as const;

const operationalRolePermissions = [
  ["role-admin", "perm-projects-read"],
  ["role-admin", "perm-projects-manage"],
  ["role-admin", "perm-assets-read"],
  ["role-admin", "perm-assets-manage"],
  ["role-admin", "perm-incidents-read"],
  ["role-admin", "perm-incidents-create"],
  ["role-admin", "perm-rma-read"],
  ["role-admin", "perm-rma-create"],
  ["role-admin", "perm-packing-read"],
  ["role-admin", "perm-packing-create"],
  ["role-admin", "perm-finance-read"],
  ["role-crew", "perm-projects-read"],
  ["role-crew", "perm-assets-read"],
  ["role-crew", "perm-incidents-read"],
  ["role-crew", "perm-incidents-create"],
  ["role-crew", "perm-packing-read"],
  ["role-supervisor", "perm-projects-read"],
  ["role-supervisor", "perm-projects-manage"],
  ["role-supervisor", "perm-assets-read"],
  ["role-supervisor", "perm-assets-manage"],
  ["role-supervisor", "perm-incidents-read"],
  ["role-supervisor", "perm-incidents-create"],
  ["role-supervisor", "perm-rma-read"],
  ["role-supervisor", "perm-rma-create"],
  ["role-supervisor", "perm-packing-read"],
  ["role-supervisor", "perm-packing-create"],
  ["role-finance-viewer", "perm-finance-read"],
  ["role-maintenance", "perm-assets-read"],
  ["role-maintenance", "perm-incidents-read"],
  ["role-maintenance", "perm-incidents-create"],
  ["role-maintenance", "perm-rma-read"],
  ["role-maintenance", "perm-rma-create"],
] as const;

const legacyRoleMappings = [
  ["role-operations-supervisor", "role-supervisor"],
  ["role-logistics-operator", "role-supervisor"],
  ["role-vtr-operator", "role-crew"],
  ["role-maintenance-operator", "role-maintenance"],
] as const;

const defaultCommandActor = ["user-ops", "Ops Repair", "ops@metadata.cine", "+1 809 555 0199"] as const;
const demoPlaceholderUserIds = ["user-paola", "user-luis", "user-miguel"] as const;
const demoPlaceholderCrewIds = ["crew-user-paola", "crew-user-luis", "crew-user-miguel", "crew-user-ops"] as const;

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

const ensureDefaultCommandActorAccess = (db: DatabaseSync, now: string) => {
  db.prepare(
    `
      INSERT OR IGNORE INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `,
  ).run(defaultCommandActor[0], defaultCommandActor[1], defaultCommandActor[2], defaultCommandActor[3], now, now);

  db.prepare(
    `
      UPDATE users
      SET is_active = 1,
          updated_at = ?
      WHERE id = ?
    `,
  ).run(now, defaultCommandActor[0]);

  const workspaces = db.prepare("SELECT id FROM workspaces").all() as Array<{ id: string }>;
  const upsertMembership = db.prepare(
    `
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
      VALUES (?, ?, ?, 'role-admin', 'active', ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET
        role_id = 'role-admin',
        status = 'active'
    `,
  );

  workspaces.forEach((workspace) => {
    upsertMembership.run(`membership-${workspace.id}-ops`, workspace.id, defaultCommandActor[0], now, now);
  });
};

const migrateLegacyRoles = (db: DatabaseSync) => {
  legacyRoleMappings.forEach(([legacyRoleId, nextRoleId]) => {
    db.prepare(
      `
        UPDATE workspace_memberships
        SET role_id = ?
        WHERE role_id = ?
      `,
    ).run(nextRoleId, legacyRoleId);
  });

  legacyRoleMappings.forEach(([legacyRoleId]) => {
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(legacyRoleId);
    db.prepare("DELETE FROM roles WHERE id = ?").run(legacyRoleId);
  });
};

const cleanupDemoTeamPlaceholders = (db: DatabaseSync, now: string) => {
  const userPlaceholders = demoPlaceholderUserIds.map(() => "?").join(", ");
  const crewPlaceholders = demoPlaceholderCrewIds.map(() => "?").join(", ");

  db.prepare(`DELETE FROM workspace_memberships WHERE user_id IN (${userPlaceholders})`).run(...demoPlaceholderUserIds);

  db.prepare(
    `
      UPDATE users
      SET is_active = 0,
          updated_at = ?
      WHERE id IN (${userPlaceholders})
    `,
  ).run(now, ...demoPlaceholderUserIds);

  db.prepare(
    `
      UPDATE crew_members
      SET linked_user_id = NULL,
          is_active = 0,
          updated_at = ?
      WHERE id IN (${crewPlaceholders})
    `,
  ).run(now, ...demoPlaceholderCrewIds);
};

export const applyAdminFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "projects", "client_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id);");
  }

  if (!hasColumn(db, "asset_categories", "is_active")) {
    db.exec("ALTER TABLE asset_categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }
};

type AdminFoundationBootstrapOptions = {
  cleanupDemoPlaceholders?: boolean;
};

export const bootstrapAdminFoundation = (db: DatabaseSync, options: AdminFoundationBootstrapOptions = {}) => {
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
          INSERT INTO roles (id, workspace_id, key, name, description, is_system_role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            key = excluded.key,
            name = excluded.name,
            description = excluded.description,
            is_system_role = excluded.is_system_role
        `,
      ).run(id, workspaceId, key, name, description, isSystemRole, now);
    });

    migrateLegacyRoles(db);

    if (options.cleanupDemoPlaceholders) {
      cleanupDemoTeamPlaceholders(db, now);
    }

    operationalRoles.forEach(([roleId]) => {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
    });

    operationalRolePermissions.forEach(([roleId, permissionId]) => {
      db.prepare(
        `
          INSERT INTO role_permissions (role_id, permission_id, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(role_id, permission_id) DO NOTHING
        `,
      ).run(roleId, permissionId, now);
    });

    ensureDefaultCommandActorAccess(db, now);

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
