import type { DatabaseSync } from "node:sqlite";

import {
  LEGACY_RENTMAN_IMPORT_ID,
  LEGACY_RENTMAN_SOURCE_FILE,
  LEGACY_RENTMAN_SOURCE_LABEL,
  legacyRentmanSeedRows,
  type LegacyRentmanSeedRow,
} from "@db";

import { LOCAL_FALLBACK_WORKSPACE_ID } from "@contracts";

const workspaceId = LOCAL_FALLBACK_WORKSPACE_ID;
const importedAt = "2026-04-09T18:30:00.000Z";
const actorUserId = "user-ops";
const fallbackLocationId = "loc-legacy-unassigned";

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const compactText = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");

const trackingMode = (row: LegacyRentmanSeedRow) => {
  if (row.serialIdentifier || row.serialNumber) {
    return "serialized";
  }

  if (row.quantity > 1) {
    return "grouped";
  }

  return "single";
};

const cleanName = (row: LegacyRentmanSeedRow) => row.primaryName || row.secondaryName || `Legacy item ${row.rowNumber}`;

const createImportTimestamp = (rowNumber: number) => {
  const base = new Date(importedAt);
  base.setSeconds(base.getSeconds() + rowNumber);
  return base.toISOString();
};

const ensureFallbackLocation = (db: DatabaseSync) => {
  db.prepare(
    `
      INSERT OR IGNORE INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
      VALUES (?, ?, 'LEG-UNASSIGNED', 'Legacy Storage / Unassigned', 'storage', 'Fallback slot for legacy rows without warehouse location', 1, ?)
    `,
  ).run(fallbackLocationId, workspaceId, importedAt);
};

const ensureWarehouseLocations = (db: DatabaseSync) => {
  const statement = db.prepare(
    `
      INSERT OR IGNORE INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
      VALUES (?, ?, ?, ?, 'storage', ?, 1, ?)
    `,
  );

  const seen = new Set<string>();

  for (const row of legacyRentmanSeedRows) {
    if (!row.warehouseSlot || seen.has(row.warehouseSlot)) {
      continue;
    }

    seen.add(row.warehouseSlot);

    statement.run(
      `loc-legacy-${slugify(row.warehouseSlot)}`,
      workspaceId,
      row.warehouseSlot,
      `Storage / ${row.warehouseSlot}`,
      `Legacy Rentman warehouse slot ${row.warehouseSlot}`,
      importedAt,
    );
  }
};

const ensureCategoryHierarchy = (db: DatabaseSync) => {
  const insertCategory = db.prepare(
    `
      INSERT OR IGNORE INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const categoryByPath = new Map<string, string>();

  for (const row of legacyRentmanSeedRows) {
    const normalizedPath = row.folderPath || "Legacy/Uncategorized";
    const segments = normalizedPath
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (!segments.length) {
      segments.push("Legacy", "Uncategorized");
    }

    let parentCategoryId: string | null = null;
    let runningPath = "";

    for (const segment of segments) {
      runningPath = runningPath ? `${runningPath}/${segment}` : segment;

      if (categoryByPath.has(runningPath)) {
        parentCategoryId = categoryByPath.get(runningPath) ?? null;
        continue;
      }

      const categoryId = `cat-legacy-${slugify(runningPath) || `row-${row.rowNumber}`}`;
      const categoryCode = `LEG-${slugify(runningPath).toUpperCase() || row.rowNumber}`;

      insertCategory.run(
        categoryId,
        workspaceId,
        parentCategoryId,
        categoryCode,
        segment,
        `Legacy import path: ${runningPath}`,
        importedAt,
      );

      categoryByPath.set(runningPath, categoryId);
      parentCategoryId = categoryId;
    }
  }
};

const clearPreviousLegacyImport = (db: DatabaseSync) => {
  db.prepare("DELETE FROM legacy_rentman_asset_links").run();
  db.prepare("DELETE FROM legacy_rentman_items").run();
  db.prepare("DELETE FROM legacy_rentman_imports WHERE id = ?").run(LEGACY_RENTMAN_IMPORT_ID);

  db.prepare("DELETE FROM asset_current_state WHERE asset_id LIKE 'asset-legacy-rentman-%'").run();
  db.prepare("DELETE FROM asset_events WHERE asset_id LIKE 'asset-legacy-rentman-%'").run();
  db.prepare("DELETE FROM asset_assignments WHERE asset_id LIKE 'asset-legacy-rentman-%'").run();
  db.prepare("DELETE FROM asset_files WHERE asset_id LIKE 'asset-legacy-rentman-%'").run();
  db.prepare("DELETE FROM assets WHERE id LIKE 'asset-legacy-rentman-%'").run();
};

const getLocationId = (warehouseSlot: string) =>
  warehouseSlot ? `loc-legacy-${slugify(warehouseSlot)}` : fallbackLocationId;

const getCategoryId = (folderPath: string, rowNumber: number) => {
  const normalizedPath = folderPath || "Legacy/Uncategorized";
  const lastSegment = normalizedPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

  return `cat-legacy-${slugify(lastSegment) || `row-${rowNumber}`}`;
};

const createLegacyNote = (row: LegacyRentmanSeedRow) =>
  compactText([
    row.externalNote ? `Legacy note: ${row.externalNote}` : null,
    row.qrCode ? `Legacy QR: ${row.qrCode}` : null,
    row.positionType ? `Legacy type: ${row.positionType}` : null,
  ]);

export const bootstrapLegacyRentmanDemo = (db: DatabaseSync) => {
  const importStatus = db
    .prepare(
      `
        SELECT
          EXISTS(SELECT 1 FROM legacy_rentman_imports WHERE id = ?) AS has_import,
          (SELECT COUNT(*) FROM legacy_rentman_items WHERE import_id = ?) AS item_count,
          (SELECT COUNT(*) FROM legacy_rentman_asset_links) AS link_count
      `,
    )
    .get(LEGACY_RENTMAN_IMPORT_ID, LEGACY_RENTMAN_IMPORT_ID) as {
    has_import: number;
    item_count: number;
    link_count: number;
  };

  if (
    importStatus.has_import === 1 &&
    importStatus.item_count === legacyRentmanSeedRows.length &&
    importStatus.link_count === legacyRentmanSeedRows.length
  ) {
    return;
  }

  db.exec("BEGIN");

  try {
    clearPreviousLegacyImport(db);
    ensureFallbackLocation(db);
    ensureWarehouseLocations(db);
    ensureCategoryHierarchy(db);

    db.prepare(
      `
        INSERT INTO legacy_rentman_imports (
          id,
          workspace_id,
          source_label,
          source_file_name,
          source_row_count,
          imported_at,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      LEGACY_RENTMAN_IMPORT_ID,
      workspaceId,
      LEGACY_RENTMAN_SOURCE_LABEL,
      LEGACY_RENTMAN_SOURCE_FILE,
      legacyRentmanSeedRows.length,
      importedAt,
      "Mounted as the base legacy inventory dataset for the foundation shell.",
    );

    const insertLegacyItem = db.prepare(
      `
        INSERT INTO legacy_rentman_items (
          id,
          import_id,
          workspace_id,
          source_row_number,
          serial_number,
          serial_identifier,
          primary_name,
          current_quantity,
          warehouse_slot,
          has_accessories,
          qr_code_value,
          folder_path,
          folder_type,
          legacy_code,
          secondary_name,
          position_type,
          external_note,
          raw_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const insertAsset = db.prepare(
      `
        INSERT INTO assets (
          id,
          workspace_id,
          category_id,
          name,
          brand,
          model,
          serial_number,
          internal_code,
          description,
          purchase_date,
          purchase_price,
          currency,
          replacement_value,
          current_book_value,
          ownership_type,
          default_location_id,
          qr_code_value,
          notes,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'legacy_import', ?, ?, ?, 1, ?, ?)
      `,
    );

    const insertLink = db.prepare(
      `
        INSERT INTO legacy_rentman_asset_links (legacy_item_id, asset_id, import_strategy, created_at)
        VALUES (?, ?, ?, ?)
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
        VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'asset_created', ?, NULL, NULL, ?, ?, 'integration', 'desktop', ?, ?, ?)
      `,
    );

    const insertState = db.prepare(
      `
        INSERT INTO asset_current_state (
          asset_id,
          workspace_id,
          current_location_id,
          current_project_id,
          current_department_id,
          current_responsible_user_id,
          active_assignment_id,
          condition_status,
          operational_status,
          custody_status,
          last_event_id,
          version,
          updated_at
        )
        VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'Imported', 'ready', 'available', ?, 1, ?)
      `,
    );

    for (const row of legacyRentmanSeedRows) {
      const legacyItemId = `legacy-rentman-row-${row.rowNumber}`;
      const assetId = `asset-legacy-rentman-${row.rowNumber}`;
      const eventId = `event-legacy-rentman-${row.rowNumber}`;
      const eventTimestamp = createImportTimestamp(row.rowNumber);
      const quantity = row.quantity > 0 ? row.quantity : 0;
      const locationId = getLocationId(row.warehouseSlot);
      const categoryId = getCategoryId(row.folderPath, row.rowNumber);
      const displayName = cleanName(row);
      const importMode = trackingMode(row);
      const rawJson = JSON.stringify(row.raw);

      insertLegacyItem.run(
        legacyItemId,
        LEGACY_RENTMAN_IMPORT_ID,
        workspaceId,
        row.rowNumber,
        row.serialNumber || null,
        row.serialIdentifier || null,
        displayName,
        quantity,
        row.warehouseSlot || null,
        row.hasAccessories ? 1 : 0,
        row.qrCode || null,
        row.folderPath || null,
        row.folderType || null,
        row.legacyCode || null,
        row.secondaryName || null,
        row.positionType || null,
        row.externalNote || null,
        rawJson,
        importedAt,
      );

      insertAsset.run(
        assetId,
        workspaceId,
        categoryId,
        displayName,
        row.serialNumber || null,
        `RM-${row.legacyCode || "ROW"}-${row.rowNumber}`,
        compactText([
          "Legacy Rentman inventory import",
          row.folderPath || null,
          row.warehouseSlot ? `Slot ${row.warehouseSlot}` : null,
        ]),
        locationId,
        row.qrCode || null,
        createLegacyNote(row) || null,
        importedAt,
        importedAt,
      );

      insertLink.run(legacyItemId, assetId, importMode, importedAt);

      insertEvent.run(
        eventId,
        workspaceId,
        assetId,
        actorUserId,
        locationId,
        eventTimestamp,
        `cmd-legacy-rentman-${row.rowNumber}`,
        `Imported from ${LEGACY_RENTMAN_SOURCE_LABEL}`,
        rawJson,
        eventTimestamp,
      );

      insertState.run(assetId, workspaceId, locationId, eventId, eventTimestamp);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
