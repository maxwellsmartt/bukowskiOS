import type { DatabaseSync } from "node:sqlite";

import type { CreateRmaCaseCommand, RmaCaseAssetInput, RmaCaseMutationResult, UpdateRmaCaseCommand } from "@contracts";

const workspaceId = "workspace-metadata";

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

const uniqueAssetItems = (assetItems: RmaCaseAssetInput[]) => {
  const seen = new Set<string>();
  const normalized = assetItems
    .map((item) => ({
      assetId: item.assetId.trim(),
      equipmentYear: optionalValue(item.equipmentYear),
      issueSummary: ensureValue(item.issueSummary, "Issue summary"),
    }))
    .filter((item) => item.assetId);

  return normalized.filter((item) => {
    if (seen.has(item.assetId)) {
      return false;
    }

    seen.add(item.assetId);
    return true;
  });
};

const loadManufacturer = (db: DatabaseSync, manufacturerId: string) => {
  const row = db
    .prepare(
      `
        SELECT id, name, COALESCE(support_email, '') AS support_email
        FROM manufacturers
        WHERE workspace_id = ?
          AND id = ?
          AND is_active = 1
        LIMIT 1
      `,
    )
    .get(workspaceId, manufacturerId) as { id: string; name: string; support_email: string } | undefined;

  if (!row) {
    throw new Error("Selected manufacturer was not found.");
  }

  return row;
};

const assertAssetsEligibleForCreate = (db: DatabaseSync, assetIds: string[]) => {
  if (!assetIds.length) {
    throw new Error("At least one maintenance asset is required.");
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT asset_current_state.asset_id
        FROM asset_current_state
        WHERE asset_current_state.workspace_id = ?
          AND asset_current_state.operational_status = 'maintenance'
          AND asset_current_state.asset_id IN (${placeholders})
      `,
    )
    .all(workspaceId, ...assetIds) as Array<{ asset_id: string }>;

  if (rows.length !== assetIds.length) {
    throw new Error("RMA cases can only be created from assets currently in maintenance.");
  }
};

const assertAssetsEligibleForUpdate = (db: DatabaseSync, rmaCaseId: string, assetIds: string[]) => {
  if (!assetIds.length) {
    throw new Error("At least one maintenance asset is required.");
  }

  const existingRows = db
    .prepare("SELECT asset_id FROM rma_case_assets WHERE rma_case_id = ?")
    .all(rmaCaseId) as Array<{ asset_id: string }>;

  const existingAssetIds = new Set(existingRows.map((row) => row.asset_id));
  const newAssetIds = assetIds.filter((assetId) => !existingAssetIds.has(assetId));

  if (!newAssetIds.length) {
    return;
  }

  assertAssetsEligibleForCreate(db, newAssetIds);
};

const replaceCaseAssets = (db: DatabaseSync, rmaCaseId: string, assetItems: ReturnType<typeof uniqueAssetItems>, now: string) => {
  db.prepare("DELETE FROM rma_case_assets WHERE rma_case_id = ?").run(rmaCaseId);

  const insert = db.prepare(
    `
      INSERT INTO rma_case_assets (
        id,
        rma_case_id,
        asset_id,
        equipment_year,
        issue_summary,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );

  assetItems.forEach((item, index) => {
    insert.run(`${rmaCaseId}-asset-${index + 1}`, rmaCaseId, item.assetId, item.equipmentYear, item.issueSummary, now, now);
  });
};

export const createRmaMutationService = (db: DatabaseSync) => ({
  createRmaCase(input: CreateRmaCaseCommand): RmaCaseMutationResult {
    const now = new Date().toISOString();
    const assetItems = uniqueAssetItems(input.assetItems);
    const manufacturer = loadManufacturer(db, ensureValue(input.manufacturerId, "Manufacturer"));
    const supportEmail = optionalValue(input.supportEmail) ?? optionalValue(manufacturer.support_email) ?? "";
    const title = ensureValue(input.title, "RMA title");
    const problemSummary = ensureValue(input.problemSummary, "Problem summary");

    assertAssetsEligibleForCreate(
      db,
      assetItems.map((item) => item.assetId),
    );

    const rmaCaseId = `rma-${Date.now().toString(36)}`;

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO rma_cases (
            id,
            workspace_id,
            manufacturer_id,
            title,
            support_email,
            problem_summary,
            notes,
            status,
            created_by_user_id,
            created_at,
            updated_at,
            sent_at,
            closed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', 'user-ops', ?, ?, NULL, NULL)
        `,
      ).run(rmaCaseId, workspaceId, manufacturer.id, title, supportEmail, problemSummary, optionalValue(input.notes), now, now);

      replaceCaseAssets(db, rmaCaseId, assetItems, now);

      db.exec("COMMIT");
      return {
        rmaCaseId,
        summary: `${assetItems.length} asset${assetItems.length === 1 ? "" : "s"} prepared for RMA draft.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  updateRmaCase(input: UpdateRmaCaseCommand): RmaCaseMutationResult {
    const now = new Date().toISOString();
    const assetItems = uniqueAssetItems(input.assetItems);
    const manufacturer = loadManufacturer(db, ensureValue(input.manufacturerId, "Manufacturer"));
    const supportEmail = optionalValue(input.supportEmail) ?? optionalValue(manufacturer.support_email) ?? "";
    const title = ensureValue(input.title, "RMA title");
    const problemSummary = ensureValue(input.problemSummary, "Problem summary");
    const status = ensureValue(input.status, "RMA status");

    assertAssetsEligibleForUpdate(
      db,
      input.rmaCaseId,
      assetItems.map((item) => item.assetId),
    );

    const previous = db
      .prepare("SELECT sent_at, closed_at FROM rma_cases WHERE id = ? LIMIT 1")
      .get(input.rmaCaseId) as { sent_at: string | null; closed_at: string | null } | undefined;

    if (!previous) {
      throw new Error("RMA case not found.");
    }

    const nextSentAt = status === "Sent" ? previous.sent_at ?? now : previous.sent_at;
    const nextClosedAt = status === "Closed" ? previous.closed_at ?? now : null;

    db.exec("BEGIN");

    try {
      const result = db.prepare(
        `
          UPDATE rma_cases
          SET manufacturer_id = ?,
              title = ?,
              support_email = ?,
              problem_summary = ?,
              notes = ?,
              status = ?,
              updated_at = ?,
              sent_at = ?,
              closed_at = ?
          WHERE id = ?
        `,
      ).run(
        manufacturer.id,
        title,
        supportEmail,
        problemSummary,
        optionalValue(input.notes),
        status,
        now,
        nextSentAt,
        nextClosedAt,
        input.rmaCaseId,
      );

      if (!result.changes) {
        throw new Error("RMA case not found.");
      }

      replaceCaseAssets(db, input.rmaCaseId, assetItems, now);

      db.exec("COMMIT");
      return {
        rmaCaseId: input.rmaCaseId,
        summary: `RMA case updated to ${status.toLowerCase()}.`,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
});

export type RmaMutationService = ReturnType<typeof createRmaMutationService>;
