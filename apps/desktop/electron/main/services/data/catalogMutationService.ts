import type { DatabaseSync } from "node:sqlite";

import type {
  CreateCatalogEntityInput,
  DeleteCatalogEntitiesInput,
  DeleteCatalogEntityInput,
  ExportCatalogCsvInput,
  ImportCatalogCsvInput,
  PreviewCatalogCsvImportInput,
  UpdateCatalogEntityInput,
} from "@contracts";

import { createCodeGenerationService } from "./codeGenerationService";
import { createCatalogCsvService } from "./catalogCsvService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const ensureValue = (value: string | undefined, label: string) => {
  const nextValue = value?.trim() ?? "";

  if (!nextValue) {
    throw new Error(`${label} is required.`);
  }

  return nextValue;
};

const optionalValue = (value: string | undefined) => {
  const nextValue = value?.trim() ?? "";
  return nextValue || null;
};

const uniqueValues = (values: string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

const normalizeKitAssetSelections = (
  assetSelections:
    | Array<{
        assetId: string;
        quantity: number;
      }>
    | undefined,
  fallbackAssetIds?: string[],
) => {
  const byAssetId = new Map<string, number>();

  (assetSelections ?? []).forEach((selection) => {
    const assetId = selection.assetId?.trim();
    const quantity = Math.trunc(selection.quantity);

    if (!assetId) {
      return;
    }

    byAssetId.set(assetId, quantity);
  });

  if (!byAssetId.size) {
    uniqueValues(fallbackAssetIds).forEach((assetId) => {
      byAssetId.set(assetId, 1);
    });
  }

  return [...byAssetId.entries()]
    .map(([assetId, quantity]) => ({
      assetId,
      quantity,
    }))
    .filter((selection) => Number.isInteger(selection.quantity) && selection.quantity > 0);
};

const replaceCrewBankAccounts = (
  db: DatabaseSync,
  crewMemberId: string,
  bankAccounts:
    | Array<{
        bankName?: string;
        accountHolder?: string;
        accountNumber: string;
        accountType?: string;
        routingNumber?: string;
        notes?: string;
        maskInPreview?: boolean;
      }>
    | undefined,
  now: string,
) => {
  db.prepare("DELETE FROM crew_bank_accounts WHERE crew_member_id = ?").run(crewMemberId);

  (bankAccounts ?? [])
    .map((entry) => ({
      accountHolder: optionalValue(entry.accountHolder),
      accountNumber: ensureValue(entry.accountNumber, "Bank account number"),
      accountType: optionalValue(entry.accountType),
      bankName: optionalValue(entry.bankName),
      maskInPreview: entry.maskInPreview === false ? 0 : 1,
      notes: optionalValue(entry.notes),
      routingNumber: optionalValue(entry.routingNumber),
    }))
    .forEach((entry, index) => {
      db.prepare(
        `
          INSERT INTO crew_bank_accounts (
            id,
            crew_member_id,
            bank_name,
            account_holder,
            account_number,
            account_type,
            routing_number,
            notes,
            mask_in_preview,
            sort_order,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        `crew-bank-account-${crewMemberId}-${index}-${Date.now().toString(36)}`,
        crewMemberId,
        entry.bankName,
        entry.accountHolder,
        entry.accountNumber,
        entry.accountType,
        entry.routingNumber,
        entry.notes,
        entry.maskInPreview,
        index,
        now,
        now,
      );
    });
};

const assertUniqueCode = (
  db: DatabaseSync,
  tableName: "locations" | "departments" | "asset_categories" | "kits",
  code: string,
  currentId?: string,
) => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM ${tableName}
        WHERE workspace_id = ?
          AND code = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, code, currentId ?? null, currentId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error(`Code ${code} is already in use.`);
  }
};

const assertUniqueClientName = (db: DatabaseSync, name: string, currentId?: string) => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM clients
        WHERE workspace_id = ?
          AND lower(name) = lower(?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, name, currentId ?? null, currentId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error(`Client ${name} already exists.`);
  }
};

const assertUniqueProductionCompanyName = (db: DatabaseSync, name: string, currentId?: string) => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM production_companies
        WHERE workspace_id = ?
          AND lower(name) = lower(?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, name, currentId ?? null, currentId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error(`Production company ${name} already exists.`);
  }
};

const assertUniqueManufacturerName = (db: DatabaseSync, name: string, currentId?: string) => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM manufacturers
        WHERE workspace_id = ?
          AND lower(name) = lower(?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(workspaceId, name, currentId ?? null, currentId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error(`Manufacturer ${name} already exists.`);
  }
};

const assertLinkableUserExists = (db: DatabaseSync, userId: string | undefined) => {
  const nextUserId = optionalValue(userId);

  if (!nextUserId) {
    return null;
  }

  const membership = db
    .prepare(
      `
        SELECT users.id
        FROM workspace_memberships
        JOIN users ON users.id = workspace_memberships.user_id
        WHERE workspace_memberships.workspace_id = ?
          AND workspace_memberships.user_id = ?
          AND workspace_memberships.status = 'active'
          AND users.is_active = 1
        LIMIT 1
      `,
    )
    .get(workspaceId, nextUserId) as { id: string } | undefined;

  if (!membership) {
    throw new Error("Linked user must be an active internal workspace user.");
  }

  return nextUserId;
};

const assertAssetIdsExist = (db: DatabaseSync, assetIds: string[]) => {
  if (!assetIds.length) {
    return;
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT id
        FROM assets
        WHERE workspace_id = ?
          AND id IN (${placeholders})
      `,
    )
    .all(workspaceId, ...assetIds) as Array<{ id: string }>;

  if (rows.length !== assetIds.length) {
    throw new Error("One or more selected assets are no longer available in the registry.");
  }
};

const getDeleteGuardCount = (db: DatabaseSync, input: DeleteCatalogEntityInput) => {
  switch (input.entityType) {
    case "location": {
      const row = db
        .prepare(
          `
            SELECT
              (SELECT COUNT(*) FROM assets WHERE default_location_id = ?) AS asset_defaults,
              (SELECT COUNT(*) FROM asset_current_state WHERE current_location_id = ?) AS current_state,
              (SELECT COUNT(*) FROM asset_assignments WHERE source_location_id = ? OR target_location_id = ?) AS assignments,
              (SELECT COUNT(*) FROM asset_events WHERE location_id = ? OR from_location_id = ? OR to_location_id = ?) AS events
          `,
        )
        .get(input.id, input.id, input.id, input.id, input.id, input.id, input.id) as {
        asset_defaults: number;
        current_state: number;
        assignments: number;
        events: number;
      };

      return row.asset_defaults + row.current_state + row.assignments + row.events;
    }

    case "department": {
      const row = db
        .prepare(
          `
            SELECT
              (SELECT COUNT(*) FROM asset_current_state WHERE current_department_id = ?) AS current_state,
              (SELECT COUNT(*) FROM asset_assignments WHERE department_id = ?) AS assignments,
              (SELECT COUNT(*) FROM incidents WHERE department_id = ?) AS incidents,
              (SELECT COUNT(*) FROM packing_slips WHERE department_id = ?) AS packing
          `,
        )
        .get(input.id, input.id, input.id, input.id) as {
        current_state: number;
        assignments: number;
        incidents: number;
        packing: number;
      };

      return row.current_state + row.assignments + row.incidents + row.packing;
    }

    case "client": {
      const row = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE client_id = ?").get(input.id) as { count: number };
      return row.count;
    }

    case "production_company": {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM projects WHERE production_company_id = ?")
        .get(input.id) as { count: number };
      return row.count;
    }

    case "manufacturer": {
      const row = db.prepare("SELECT COUNT(*) AS count FROM rma_cases WHERE manufacturer_id = ?").get(input.id) as { count: number };
      return row.count;
    }

    case "category": {
      const row = db.prepare("SELECT COUNT(*) AS count FROM assets WHERE category_id = ?").get(input.id) as { count: number };
      return row.count;
    }

    default:
      return 0;
  }
};

const replaceKitAssets = (
  db: DatabaseSync,
  kitId: string,
  assetSelections: Array<{ assetId: string; quantity: number }>,
  now: string,
) => {
  db.prepare("DELETE FROM kit_assets WHERE kit_id = ?").run(kitId);

  const insertKitAsset = db.prepare(
    `
      INSERT INTO kit_assets (kit_id, asset_id, quantity, added_at)
      VALUES (?, ?, ?, ?)
    `,
  );

  assetSelections.forEach((selection) => {
    insertKitAsset.run(kitId, selection.assetId, selection.quantity, now);
  });
};

export const createCatalogMutationService = (db: DatabaseSync) => {
  const codeService = createCodeGenerationService(db);
  const csvService = createCatalogCsvService(db, codeService);
  const service = {
    createEntity(input: CreateCatalogEntityInput) {
      const now = new Date().toISOString();

      db.exec("BEGIN");

      try {
        switch (input.entityType) {
          case "location": {
            const code = ensureValue(input.code, "Location code").toUpperCase();
            assertUniqueCode(db, "locations", code);

            db.prepare(
              `
                INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)
              `,
            ).run(
              `location-${slugify(code)}-${Date.now().toString(36)}`,
              workspaceId,
              code,
              ensureValue(input.name, "Location name"),
              ensureValue(input.locationType, "Location type"),
              optionalValue(input.description),
              now,
            );
            break;
          }

          case "department": {
            const code = ensureValue(input.code, "Department code").toUpperCase();
            assertUniqueCode(db, "departments", code);

            db.prepare(
              `
                INSERT INTO departments (id, workspace_id, code, name, description, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
              `,
            ).run(
              `department-${slugify(code)}-${Date.now().toString(36)}`,
              workspaceId,
              code,
              ensureValue(input.name, "Department name"),
              optionalValue(input.description),
              now,
            );
            break;
          }

          case "crew": {
            const crewName = ensureValue(input.fullName, "Crew name");
            const crewId = `crew-${slugify(crewName)}-${Date.now().toString(36)}`;
            const linkedUserId = assertLinkableUserExists(db, input.linkedUserId);
            db.prepare(
              `
                INSERT INTO crew_members (
                  id, workspace_id, full_name, primary_department_id, linked_user_id, document_id, role_label, email, phone, notes, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
              `,
            ).run(
              crewId,
              workspaceId,
              crewName,
              optionalValue(input.primaryDepartmentId),
              linkedUserId,
              optionalValue(input.documentId),
              optionalValue(input.roleLabel),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              now,
            );
            replaceCrewBankAccounts(db, crewId, input.bankAccounts, now);
            break;
          }

          case "client": {
            const name = ensureValue(input.name, "Client name");
            assertUniqueClientName(db, name);

            db.prepare(
              `
                INSERT INTO clients (
                  id, workspace_id, name, contact_name, email, phone, notes, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
              `,
            ).run(
              `client-${slugify(name)}-${Date.now().toString(36)}`,
              workspaceId,
              name,
              optionalValue(input.contactName),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              now,
            );
            break;
          }

          case "production_company": {
            const name = ensureValue(input.name, "Production company name");
            assertUniqueProductionCompanyName(db, name);

            db.prepare(
              `
                INSERT INTO production_companies (
                  id, workspace_id, name, contact_name, email, phone, notes, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
              `,
            ).run(
              `production-company-${slugify(name)}-${Date.now().toString(36)}`,
              workspaceId,
              name,
              optionalValue(input.contactName),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              now,
            );
            break;
          }

          case "manufacturer": {
            const name = ensureValue(input.name, "Manufacturer name");
            assertUniqueManufacturerName(db, name);

            db.prepare(
              `
                INSERT INTO manufacturers (
                  id, workspace_id, name, contact_name, support_email, phone, notes, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
              `,
            ).run(
              `manufacturer-${slugify(name)}-${Date.now().toString(36)}`,
              workspaceId,
              name,
              optionalValue(input.contactName),
              optionalValue(input.supportEmail),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              now,
            );
            break;
          }

          case "category": {
            const code = ensureValue(input.code, "Category code").toUpperCase();
            assertUniqueCode(db, "asset_categories", code);

            db.prepare(
              `
                INSERT INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at, is_active)
                VALUES (?, ?, NULL, ?, ?, ?, ?, 1)
              `,
            ).run(
              `category-${slugify(code)}-${Date.now().toString(36)}`,
              workspaceId,
              code,
              ensureValue(input.name, "Category name"),
              optionalValue(input.description),
              now,
            );
            break;
          }

          case "kit": {
            const code = ensureValue(input.code, "Kit code").toUpperCase();
            const assetSelections = normalizeKitAssetSelections(input.assetSelections, input.assetIds);
            const assetIds = assetSelections.map((selection) => selection.assetId);
            assertUniqueCode(db, "kits", code);
            assertAssetIdsExist(db, assetIds);

            const kitId = `kit-${slugify(code)}-${Date.now().toString(36)}`;

            db.prepare(
              `
                INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
              `,
            ).run(
              kitId,
              workspaceId,
              code,
              ensureValue(input.name, "Kit name"),
              optionalValue(input.description),
              optionalValue(input.notes),
              now,
              now,
            );

            replaceKitAssets(db, kitId, assetSelections, now);
            codeService.ensurePrimaryCode({
              workspaceId,
              entityType: "kit",
              entityId: kitId,
              preferredCodeValue: `KIT-${code}`,
            });
            break;
          }
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    updateEntity(input: UpdateCatalogEntityInput) {
      const now = new Date().toISOString();

      db.exec("BEGIN");

      try {
        switch (input.entityType) {
          case "location": {
            const code = ensureValue(input.code, "Location code").toUpperCase();
            assertUniqueCode(db, "locations", code, input.id);
            const result = db.prepare(
              `
                UPDATE locations
                SET code = ?, name = ?, type = ?, description = ?
                WHERE id = ?
              `,
            ).run(
              code,
              ensureValue(input.name, "Location name"),
              ensureValue(input.locationType, "Location type"),
              optionalValue(input.description),
              input.id,
            );
            if (!result.changes) {
              throw new Error("Location not found.");
            }
            break;
          }

          case "department": {
            const code = ensureValue(input.code, "Department code").toUpperCase();
            assertUniqueCode(db, "departments", code, input.id);
            const result = db.prepare(
              `
                UPDATE departments
                SET code = ?, name = ?, description = ?
                WHERE id = ?
              `,
            ).run(code, ensureValue(input.name, "Department name"), optionalValue(input.description), input.id);
            if (!result.changes) {
              throw new Error("Department not found.");
            }
            break;
          }

          case "crew": {
            const linkedUserId = assertLinkableUserExists(db, input.linkedUserId);
            const result = db.prepare(
              `
                UPDATE crew_members
                SET full_name = ?, primary_department_id = ?, linked_user_id = ?, document_id = ?, role_label = ?, email = ?, phone = ?, notes = ?, updated_at = ?
                WHERE id = ?
              `,
            ).run(
              ensureValue(input.fullName, "Crew name"),
              optionalValue(input.primaryDepartmentId),
              linkedUserId,
              optionalValue(input.documentId),
              optionalValue(input.roleLabel),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              input.id,
            );
            if (!result.changes) {
              throw new Error("Crew member not found.");
            }
            replaceCrewBankAccounts(db, input.id, input.bankAccounts, now);
            break;
          }

          case "client": {
            const name = ensureValue(input.name, "Client name");
            assertUniqueClientName(db, name, input.id);
            const result = db.prepare(
              `
                UPDATE clients
                SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, updated_at = ?
                WHERE id = ?
              `,
            ).run(
              name,
              optionalValue(input.contactName),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              input.id,
            );
            if (!result.changes) {
              throw new Error("Client not found.");
            }

            db.prepare("UPDATE projects SET client_name = ? WHERE client_id = ?").run(name, input.id);
            break;
          }

          case "production_company": {
            const name = ensureValue(input.name, "Production company name");
            assertUniqueProductionCompanyName(db, name, input.id);
            const result = db.prepare(
              `
                UPDATE production_companies
                SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?, updated_at = ?
                WHERE id = ?
              `,
            ).run(
              name,
              optionalValue(input.contactName),
              optionalValue(input.email),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              input.id,
            );

            if (!result.changes) {
              throw new Error("Production company not found.");
            }

            db.prepare("UPDATE projects SET production_company_name = ? WHERE production_company_id = ?").run(name, input.id);
            break;
          }

          case "manufacturer": {
            const name = ensureValue(input.name, "Manufacturer name");
            assertUniqueManufacturerName(db, name, input.id);
            const result = db.prepare(
              `
                UPDATE manufacturers
                SET name = ?, contact_name = ?, support_email = ?, phone = ?, notes = ?, updated_at = ?
                WHERE id = ?
              `,
            ).run(
              name,
              optionalValue(input.contactName),
              optionalValue(input.supportEmail),
              optionalValue(input.phone),
              optionalValue(input.notes),
              now,
              input.id,
            );
            if (!result.changes) {
              throw new Error("Manufacturer not found.");
            }

            db.prepare("UPDATE rma_cases SET support_email = COALESCE(?, support_email) WHERE manufacturer_id = ? AND (support_email IS NULL OR trim(support_email) = '')").run(
              optionalValue(input.supportEmail),
              input.id,
            );
            break;
          }

          case "category": {
            const code = ensureValue(input.code, "Category code").toUpperCase();
            assertUniqueCode(db, "asset_categories", code, input.id);
            const result = db.prepare(
              `
                UPDATE asset_categories
                SET code = ?, name = ?, description = ?
                WHERE id = ?
              `,
            ).run(code, ensureValue(input.name, "Category name"), optionalValue(input.description), input.id);
            if (!result.changes) {
              throw new Error("Category not found.");
            }
            break;
          }

          case "kit": {
            const code = ensureValue(input.code, "Kit code").toUpperCase();
            const assetSelections = normalizeKitAssetSelections(input.assetSelections, input.assetIds);
            const assetIds = assetSelections.map((selection) => selection.assetId);
            assertUniqueCode(db, "kits", code, input.id);
            assertAssetIdsExist(db, assetIds);
            const result = db.prepare(
              `
                UPDATE kits
                SET code = ?, name = ?, description = ?, notes = ?, updated_at = ?
                WHERE id = ?
              `,
            ).run(
              code,
              ensureValue(input.name, "Kit name"),
              optionalValue(input.description),
              optionalValue(input.notes),
              now,
              input.id,
            );
            if (!result.changes) {
              throw new Error("Kit not found.");
            }

            replaceKitAssets(db, input.id, assetSelections, now);
            codeService.ensurePrimaryCode({
              workspaceId,
              entityType: "kit",
              entityId: input.id,
              preferredCodeValue: `KIT-${code}`,
            });
            break;
          }
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    deleteEntity(input: DeleteCatalogEntityInput) {
      const relationCount = getDeleteGuardCount(db, input);

      if (relationCount > 0) {
        throw new Error("This catalog record already has linked operational data and cannot be deleted.");
      }

      db.exec("BEGIN");

      try {
        switch (input.entityType) {
          case "location": {
            const result = db.prepare("DELETE FROM locations WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Location not found.");
            }
            break;
          }
          case "department": {
            const result = db.prepare("DELETE FROM departments WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Department not found.");
            }
            break;
          }
          case "crew": {
            const result = db.prepare("DELETE FROM crew_members WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Crew member not found.");
            }
            break;
          }
          case "client": {
            const result = db.prepare("DELETE FROM clients WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Client not found.");
            }
            break;
          }
          case "production_company": {
            const result = db.prepare("DELETE FROM production_companies WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Production company not found.");
            }
            break;
          }
          case "manufacturer": {
            const result = db.prepare("DELETE FROM manufacturers WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Manufacturer not found.");
            }
            break;
          }
          case "category": {
            const result = db.prepare("DELETE FROM asset_categories WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Category not found.");
            }
            break;
          }
          case "kit": {
            db.prepare("DELETE FROM kit_assets WHERE kit_id = ?").run(input.id);
            db.prepare("DELETE FROM scannable_codes WHERE entity_type = 'kit' AND entity_id = ?").run(input.id);
            const result = db.prepare("DELETE FROM kits WHERE id = ?").run(input.id);
            if (!result.changes) {
              throw new Error("Kit not found.");
            }
            break;
          }
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    deleteEntities(input: DeleteCatalogEntitiesInput) {
      const uniqueIds = uniqueValues(input.ids);

      if (!uniqueIds.length) {
        throw new Error("Select at least one catalog record.");
      }

      uniqueIds.forEach((id) => {
        const relationCount = getDeleteGuardCount(db, { entityType: input.entityType, id });

        if (relationCount > 0) {
          throw new Error("One or more selected records already have linked operational data and cannot be deleted.");
        }
      });

      uniqueIds.forEach((id) => {
        service.deleteEntity({ entityType: input.entityType, id });
      });
    },

    buildCsvExport(input: ExportCatalogCsvInput) {
      return csvService.buildExport(input);
    },

    previewCsvImport(input: PreviewCatalogCsvImportInput) {
      return csvService.previewImport(input);
    },

    importCsv(input: ImportCatalogCsvInput) {
      return csvService.importCsv(input);
    },
  };

  return service;
};

export type CatalogMutationService = ReturnType<typeof createCatalogMutationService>;
