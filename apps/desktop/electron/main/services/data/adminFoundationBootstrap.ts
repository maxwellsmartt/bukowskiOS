import type { DatabaseSync } from "node:sqlite";

import { createCodeGenerationService } from "./codeGenerationService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

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
